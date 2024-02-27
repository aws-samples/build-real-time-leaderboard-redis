// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { IPeer, IVpc, Port, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { DatabaseInstance, DatabaseInstanceEngine, ParameterGroup } from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { Network } from "./network";
import { IKey } from "aws-cdk-lib/aws-kms";
import { CfnCacheCluster, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { CanonicalUserPrincipal, Effect, Grant, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Provider } from "aws-cdk-lib/custom-resources";
import { CustomResource, Duration, Names, RemovalPolicy, Size, Stack } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { HostedRotation } from "aws-cdk-lib/aws-secretsmanager";
import { PermissionGenerator } from "../util/permission-generator";
import { NameGenerator } from "../util";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { BuildEnvironmentVariableType, BuildSpec, LinuxBuildImage, Project } from "aws-cdk-lib/aws-codebuild";

export interface DatabaseProps {
    vpc: IVpc,
    key: IKey
}

export class Database extends Construct {
    readonly rds: DatabaseInstance
    readonly cache: CfnCacheCluster
    readonly cacheSecurityGroup: SecurityGroup
    readonly rdsSecurityGroup: SecurityGroup

    private static readonly ELASTICACHE_SERVICE_CANONICAL_ID = "540804c33a284a299d2547575ce1010f2312ef3da9b3a053c8bc45bf233e4353"
    private static readonly DB_SNAPSHOT_NAME = "leaderboard-mysql.dump.gz"
    private static readonly REDIS_SNAPSHOT_NAME = "cache-snapshot-0001.rdb"

    constructor(scope: Construct, id: string, props: DatabaseProps) {
        super(scope, id)

        this.rdsSecurityGroup = new SecurityGroup(this, "RDSSecurityGroup", {
            vpc: props.vpc
        })

        this.cacheSecurityGroup = new SecurityGroup(this, "CacheSecurityGroup", {
            vpc: props.vpc
        })

        this.rdsSecurityGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)
        this.cacheSecurityGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)

        const databaseSnapshotsPrep = this.prepareDatabaseSnapshots(props)

        this.rds = new DatabaseInstance(this, "RDSDatabase", {
            engine: DatabaseInstanceEngine.MYSQL,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_DATABASE
            }),
            securityGroups: [this.rdsSecurityGroup],
            multiAz: false,
            publiclyAccessible: false,
            storageEncrypted: true,
            storageEncryptionKey: props.key,
            databaseName: "leaderboard",
            allocatedStorage: 250,
            maxAllocatedStorage: 1000,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const rdsRotationSecurityGroup = new SecurityGroup(this, "RDSRotationSecurityGroup", {
            vpc: props.vpc
        })

        this.grantRDSAccess(this.rdsSecurityGroup)

        this.rds.secret?.addRotationSchedule("RDSSecretRotation", {
            automaticallyAfter: Duration.days(30),
            rotateImmediatelyOnUpdate: true,
            hostedRotation: HostedRotation.mysqlSingleUser({
                vpc: props.vpc,
                vpcSubnets: props.vpc.selectSubnets({
                    subnetGroupName: Network.SUBNET_TYPE_APPLICATION
                }),
                securityGroups: [rdsRotationSecurityGroup],
                functionName: NameGenerator.generate(this, "RDSSecretRotation")
            })
        })

        this.restoreRDSSnapshotFromS3(databaseSnapshotsPrep, props)

        NagSuppressions.addResourceSuppressions(this.rds, [
            {
                id: "AwsSolutions-RDS3",
                reason: "Database is for demo purposes only, high-availability not needed"
            },
            {
                id: "AwsSolutions-RDS10",
                reason: "Database is for demo purposes only"
            },
            {
                id: "AwsSolutions-RDS11",
                reason: "Database is for demo purposes only"
            }
        ])

        const cacheSubnetGroupName = `gaming-leaderboard-subnetgroup-${Names.uniqueResourceName(this, {maxLength: 5})}`

        const cacheSubnetGroup = new CfnSubnetGroup(this, "CacheSubnetGroup", {
            subnetIds: props.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_DATABASE
            }).subnetIds,
            description: "Subnet group for Gaming Leaderboard Cache",
            cacheSubnetGroupName: cacheSubnetGroupName
        })

        this.cache = new CfnCacheCluster(this, "Redis", {
            cacheNodeType: "cache.m6g.large",
            engine: "redis",
            numCacheNodes: 1,
            vpcSecurityGroupIds: [this.cacheSecurityGroup.securityGroupId],
            cacheSubnetGroupName: cacheSubnetGroupName,
            snapshotArns: [
                `${databaseSnapshotsPrep.bucket.bucketArn}/${Database.REDIS_SNAPSHOT_NAME}`
            ]
        })

        databaseSnapshotsPrep.ecGrant.applyBefore(this.cache)

        NagSuppressions.addResourceSuppressions(this.cache, [
            {
                id: "AwsSolutions-AEC5",
                reason: "Database is for demo purposes only"
            }
        ])

        this.cache.addDependency(cacheSubnetGroup)
        this.cache.node.addDependency(databaseSnapshotsPrep.snapshotsUpload)
        cacheSubnetGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)
        this.cache.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.createDataGenerator(props)
    }

    private createDataGenerator(props: DatabaseProps) {
        const fnName = NameGenerator.generate(this, "DataGenerator")

        const dataGeneratorRole = new Role(this, "DataGeneratorRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "VPCAwareLambda": PermissionGenerator.generateNetworkAwareLambdaPolicyDocument(Stack.of(this), fnName)
            }
        })

        dataGeneratorRole.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.rds.secret!.grantRead(dataGeneratorRole)

        NagSuppressions.addResourceSuppressions(dataGeneratorRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required due to ENIs being dynamically created by service"
            }
        ])

        const dataGeneratorSecurityGroup = new SecurityGroup(this, "DataGeneratorSecurityGroup", {
            vpc: props.vpc
        })

        dataGeneratorSecurityGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)
        this.grantRDSAccess(dataGeneratorSecurityGroup)
        this.grantRedisAccess(dataGeneratorSecurityGroup)

        const dataGeneratorFunction = new NodejsFunction(this, "DataGeneratorFunction", {
            functionName: fnName,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            }),
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                RDS_SECRET_ARN: this.rds.secret!.secretArn,
                REDIS_ENDPOINT_ADDRESS: this.cache.attrRedisEndpointAddress
            },
            entry: __dirname+"/resources/app/util/data-generator.ts",
            depsLockFilePath: __dirname+"/resources/app/package-lock.json",
            role: dataGeneratorRole,
            securityGroups: [dataGeneratorSecurityGroup],
            bundling: {
                dockerImage: Runtime.NODEJS_LATEST.bundlingImage,
                tsconfig: __dirname+"/resources/app/tsconfig.json",
                commandHooks: {
                    beforeBundling(inputDir: string, outputDir: string) {
                        return [
                            `cd ${__dirname}/resources/app`, "npm ci"
                        ]
                    },
                    beforeInstall() {
                        return []
                    },
                    afterBundling() {
                        return []
                    }
                }
            },
            timeout: Duration.minutes(15),
            memorySize: 2048
        })

        NagSuppressions.addResourceSuppressions(dataGeneratorFunction, [
            {
                id: "AwsSolutions-L1",
                reason: "Using latest version of runtime."
            }
        ])

        dataGeneratorFunction.applyRemovalPolicy(RemovalPolicy.DESTROY)
        dataGeneratorFunction.node.addDependency(this.rds)
        dataGeneratorFunction.node.addDependency(this.cache)

        // const dataGeneratorProvider = new Provider(this, "DataGeneratorProvider", {
        //     onEventHandler: dataGeneratorFunction
        // })

        // new CustomResource(this, "DataGenerator", {
        //     serviceToken: dataGeneratorProvider.serviceToken,
        //     removalPolicy: RemovalPolicy.DESTROY
        // })

        // NagSuppressions.addResourceSuppressions(dataGeneratorProvider, [
        //     {
        //         id: "AwsSolutions-IAM4",
        //         reason: "Used by CDK framework"
        //     },
        //     {
        //         id: "AwsSolutions-IAM5",
        //         reason: "Used by CDK framework"
        //     },
        //     {
        //         id: "AwsSolutions-L1",
        //         reason: "Used by CDK framework"
        //     }
        // ], true)
    }

    public grantRDSAccess(peer: IPeer) {
        this.rdsSecurityGroup.addIngressRule(peer, Port.tcp(3306))
    }

    public grantRedisAccess(peer: IPeer) {
        this.cacheSecurityGroup.addIngressRule(peer, Port.tcp(6379))
    }

    private prepareDatabaseSnapshots(props: DatabaseProps): DatabaseSnapshotPrepResults {
        const bucket = new Bucket(this, "SnapshotStaging", {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true
        })
        
        const canonicalUserForElasticacheService = new CanonicalUserPrincipal(Database.ELASTICACHE_SERVICE_CANONICAL_ID)
        
        const deployment = new BucketDeployment(this, "UploadSnapshot", {
            destinationBucket: bucket,
            sources: [
                Source.asset(__dirname+"/../../snapshots/")
            ],
            retainOnDelete: false,
            memoryLimit: 1024,
            useEfs: true,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            })
        })

        const grant = bucket.grantReadWrite(canonicalUserForElasticacheService, Database.REDIS_SNAPSHOT_NAME)

        NagSuppressions.addResourceSuppressions(bucket, [
            {
                id: "AwsSolutions-S1",
                reason: "Access log not needed, this bucket is solely used to stage the database/cache snapshots for restore during deployment"
            }
        ])

        const stack = Stack.of(this)

        NagSuppressions.addResourceSuppressions(Stack.of(this), [
            {
                id: "AwsSolutions-IAM4",
                reason: "Used by CDK for uploading assets to S3"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Used by CDK for uploading assets to S3"
            },
            {
                id: 'AwsSolutions-L1',
                reason: "Used by CDK for uploading assets to S3"
            }
        ], true)

        return {
            bucket,
            ecGrant: grant,
            snapshotsUpload: deployment
        }
    }

    private restoreRDSSnapshotFromS3(databaseSnapshotPrepResults: DatabaseSnapshotPrepResults, props: DatabaseProps) {
        const buildRole = new Role(this, "RestoreRDSSnapshotBuildRole", {
            assumedBy: new ServicePrincipal("codebuild.amazonaws.com"),
            inlinePolicies: {
                "AccessS3Staging": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "s3:GetObject"
                            ],
                            resources: [
                                databaseSnapshotPrepResults.bucket.arnForObjects(Database.DB_SNAPSHOT_NAME)
                            ]
                        })
                    ]
                }),
                "AccessDBSecret": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "secretsmanager:GetSecretValue"
                            ],
                            resources: [
                                this.rds.secret!.secretArn
                            ]
                        })
                    ]
                })
            }
        })

        const buildSecurityGroup = new SecurityGroup(this, "RestoreRDSSnapshotSecurityGroup", {
            vpc: props.vpc
        })

        this.grantRDSAccess(buildSecurityGroup)

        const build = new Project(this,"RestoreRDSSnapshotBuildProject", {
            role: buildRole,
            buildSpec: BuildSpec.fromAsset(__dirname+"/resources/snapshot/codebuild_rds_restore.yaml"),
            vpc: props.vpc,
            subnetSelection: {
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            },
            securityGroups: [buildSecurityGroup],
            environment: {
                buildImage: LinuxBuildImage.AMAZON_LINUX_2_5
            },
            environmentVariables: {
                "DB_SECRET_ARN": {
                    value: this.rds.secret!.secretArn
                },
                "SNAPSHOT_STAGING_BUCKET_NAME": {
                    value: databaseSnapshotPrepResults.bucket.bucketName
                }
            }
        })

        NagSuppressions.addResourceSuppressions(buildRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Added by CDK"
            }
        ], true)

        NagSuppressions.addResourceSuppressions(build, [
            {
                id: "AwsSolutions-CB4",
                reason: "Not needed because CodeBuild Project does not write anything to S3"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "This is added by the service"
            }
        ], true)

        build.applyRemovalPolicy(RemovalPolicy.DESTROY)
        build.node.addDependency(this.rds)
        build.node.addDependency(databaseSnapshotPrepResults.snapshotsUpload)

        const buildLifecycleFunctionName = NameGenerator.generate(this, "BuildLifecycle")
        const buildLifecycleCompleteFunctionName = NameGenerator.generate(this, "BuildLifecycleComplete")

        const buildLifecycleRole = new Role(this, "BuildLifecycleRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNonVPCAwareLambdaPolicyDocument(Stack.of(this), buildLifecycleFunctionName),
                "codebuild": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "codebuild:StartBuild",
                                "codebuild:BatchGetBuilds"
                            ],
                            resources: [
                                build.projectArn
                            ]
                        })
                    ]
                })
            }
        })

        const buildLifecycleCompleteRole = new Role(this, "BuildLifecycleCompleteRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNonVPCAwareLambdaPolicyDocument(Stack.of(this), buildLifecycleCompleteFunctionName),
                "codebuild": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "codebuild:BatchGetBuilds"
                            ],
                            resources: [
                                build.projectArn
                            ]
                        })
                    ]
                })
            }
        })

        NagSuppressions.addResourceSuppressions([buildLifecycleRole, buildLifecycleCompleteRole], [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required as the stream ID is not known during build time"
            }
        ])

        const buildLifecycleFunction = new Function(this, "BuildLifecycleFunction", {
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                PROJECT_NAME: build.projectName
            },
            code: Code.fromAsset(__dirname+"/resources/snapshot/start-monitor-build/"),
            role: buildLifecycleRole,
            timeout: Duration.seconds(5),
            memorySize: 128,
            handler: "index.handler",
            functionName: buildLifecycleFunctionName
        })

        const buildLifecycleCompleteFunction = new Function(this, "BuildLifecycleCompleteFunction", {
            runtime: Runtime.NODEJS_LATEST,
            code: Code.fromAsset(__dirname+"/resources/snapshot/start-monitor-build/"),
            role: buildLifecycleCompleteRole,
            timeout: Duration.seconds(5),
            memorySize: 128,
            handler: "index.completeHandler",
            functionName: buildLifecycleCompleteFunctionName
        })

        NagSuppressions.addResourceSuppressions([buildLifecycleFunction, buildLifecycleCompleteFunction], [
            {
                id: "AwsSolutions-L1",
                reason: "Already using the NODEJS_LATEST parameter so functions would always be using the latest version"
            }
        ])

        const buildLifecycleProvider = new Provider(this, "BuildLifecycleProvider", {
            onEventHandler: buildLifecycleFunction,
            isCompleteHandler: buildLifecycleCompleteFunction,
            queryInterval: Duration.seconds(10),
            totalTimeout: Duration.hours(1)
        })

        NagSuppressions.addResourceSuppressions(buildLifecycleProvider, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Part of CDK framework"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Part of CDK framework"
            },
            {
                id: "AwsSolutions-L1",
                reason: "Part of CDK framework"
            }
        ], true)

        new CustomResource(this, "BuildLifecycleResource", {
            serviceToken: buildLifecycleProvider.serviceToken,
            removalPolicy: RemovalPolicy.DESTROY
        })
    }
}

interface DatabaseSnapshotPrepResults {
    bucket: Bucket,
    ecGrant: Grant,
    snapshotsUpload: BucketDeployment
}