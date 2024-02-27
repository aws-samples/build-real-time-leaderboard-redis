// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import { Network } from "./network";
import { Database } from "./database";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Duration, Names, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NameGenerator, PermissionGenerator } from "../util";
import { NagSuppressions } from "cdk-nag";

export interface ApiProps {
    network: Network
    database: Database
}

export class Api extends Construct {
    readonly httpApi: HttpApi

    private readonly apiSecurityGroup: SecurityGroup

    constructor(scope: Construct, id: string, props: ApiProps) {
        super(scope, id)

        this.apiSecurityGroup = new SecurityGroup(this, "ApiSecurityGroup", {
            vpc: props.network.vpc
        })

        this.apiSecurityGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)

        props.database.grantRDSAccess(this.apiSecurityGroup)
        props.database.grantRedisAccess(this.apiSecurityGroup)

        this.httpApi = new HttpApi(this, "LeaderboardAPI", {
            corsPreflight: {
                allowOrigins: ["*"],
                allowMethods: [
                    CorsHttpMethod.ANY
                ],
                allowHeaders: ["*"],
                exposeHeaders: ["*"],
                maxAge: Duration.hours(1)
            },
            createDefaultStage: true,
            apiName: Names.uniqueResourceName(this, {})
        })

        this.httpApi.addVpcLink({
            vpc: props.network.vpc,
            subnets: props.network.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            })
        })

        this.httpApi.applyRemovalPolicy(RemovalPolicy.DESTROY)

        const retrieveLeaderboardFunctionName = NameGenerator.generate(this, "ApiRetrieveLeaderboard")
        const retrievePlayerInfoFunctionName = NameGenerator.generate(this, "ApiRetrievePlayerInfo")
        const searchUserFunctionName = NameGenerator.generate(this, "ApiSearchUser")
        const upsertScoreFunctionName = NameGenerator.generate(this, "ApiUpsertScore")

        this.createRetrieveLeaderboardApi(props, retrieveLeaderboardFunctionName)
        this.createRetrievePlayerInfoApi(props, retrievePlayerInfoFunctionName)
        this.createSearchUserApi(props, searchUserFunctionName)
        this.createUpsertScore(props, upsertScoreFunctionName)

        NagSuppressions.addResourceSuppressions(this.httpApi, [
            {
                id: "AwsSolutions-APIG1",
                reason: "Not required for demo"
            },
            {
                id: "AwsSolutions-APIG4",
                reason: "Authorization is not required for the use case"
            }
        ], true)
    }

    private createUpsertScore(props: ApiProps, functionName: string) {
        const functionRole = new Role(this, "UpsertScoreRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNetworkAwareLambdaPolicyDocument(Stack.of(this), functionName)
            }
        })

        functionRole.applyRemovalPolicy(RemovalPolicy.DESTROY)

        props.database.rds.secret!.grantRead(functionRole)

        const upsertScoreFunction = new NodejsFunction(this, "UpsertScoreFunction", {
            vpc: props.network.vpc,
            vpcSubnets: props.network.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            }),
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                RDS_SECRET_ARN: props.database.rds.secret!.secretArn,
                REDIS_ENDPOINT_ADDRESS: props.database.cache.attrRedisEndpointAddress
            },
            entry: __dirname+"/resources/app/api/upsert-score.ts",
            depsLockFilePath: __dirname+"/resources/app/package-lock.json",
            role: functionRole,
            securityGroups: [this.apiSecurityGroup],
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
            timeout: Duration.minutes(5),
            memorySize: 128,
            functionName
        })

        upsertScoreFunction.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.httpApi.addRoutes({
            path: "/users/score",
            methods: [
                HttpMethod.POST
            ],
            integration: new HttpLambdaIntegration("UpsertScoreLambdaIntegration", upsertScoreFunction)
        })    

        NagSuppressions.addResourceSuppressions(upsertScoreFunction, [
            {
                id: "AwsSolutions-L1",
                reason: "Already using latest version"
            }
        ])

        NagSuppressions.addResourceSuppressions(functionRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required because ARN can't be determined at build time"
            }
        ])
    }

    private createSearchUserApi(props: ApiProps, functionName: string) {
        const functionRole = new Role(this, "SearchUserRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNetworkAwareLambdaPolicyDocument(Stack.of(this), functionName)
            }
        })

        functionRole.applyRemovalPolicy(RemovalPolicy.DESTROY)

        props.database.rds.secret!.grantRead(functionRole)

        const searchUserApiFunction = new NodejsFunction(this, "SearchUserApiFunction", {
            vpc: props.network.vpc,
            vpcSubnets: props.network.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            }),
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                RDS_SECRET_ARN: props.database.rds.secret!.secretArn,
                REDIS_ENDPOINT_ADDRESS: props.database.cache.attrRedisEndpointAddress
            },
            entry: __dirname+"/resources/app/api/search-user.ts",
            depsLockFilePath: __dirname+"/resources/app/package-lock.json",
            role: functionRole,
            securityGroups: [this.apiSecurityGroup],
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
            timeout: Duration.minutes(5),
            memorySize: 128,
            functionName
        })

        searchUserApiFunction.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.httpApi.addRoutes({
            path: "/users/search",
            methods: [
                HttpMethod.GET
            ],
            integration: new HttpLambdaIntegration("SearchUserLambdaIntegration", searchUserApiFunction)
        })    

        NagSuppressions.addResourceSuppressions(searchUserApiFunction, [
            {
                id: "AwsSolutions-L1",
                reason: "Already using latest version"
            }
        ])

        NagSuppressions.addResourceSuppressions(functionRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required because ARN can't be determined at build time"
            }
        ])
    }

    private createRetrievePlayerInfoApi(props: ApiProps, functionName: string) {
        const functionRole = new Role(this, "RetrievePlayerInfoRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNetworkAwareLambdaPolicyDocument(Stack.of(this), functionName)
            }
        })

        functionRole.applyRemovalPolicy(RemovalPolicy.DESTROY)

        props.database.rds.secret!.grantRead(functionRole)

        const retrievePlayerInfoFunction = new NodejsFunction(this, "RetrievePlayerInfoFunction", {
            vpc: props.network.vpc,
            vpcSubnets: props.network.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            }),
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                RDS_SECRET_ARN: props.database.rds.secret!.secretArn,
                REDIS_ENDPOINT_ADDRESS: props.database.cache.attrRedisEndpointAddress
            },
            entry: __dirname+"/resources/app/api/retrieve-player-info.ts",
            depsLockFilePath: __dirname+"/resources/app/package-lock.json",
            role: functionRole,
            securityGroups: [this.apiSecurityGroup],
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
            timeout: Duration.minutes(5),
            memorySize: 128,
            functionName
        })

        retrievePlayerInfoFunction.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.httpApi.addRoutes({
            path: "/leaderboard/player-info",
            methods: [
                HttpMethod.GET
            ],
            integration: new HttpLambdaIntegration("RetrievePlayerInfoLambdaIntegration", retrievePlayerInfoFunction)
        })    
        
        NagSuppressions.addResourceSuppressions(retrievePlayerInfoFunction, [
            {
                id: "AwsSolutions-L1",
                reason: "Already using latest version"
            }
        ])

        NagSuppressions.addResourceSuppressions(functionRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required because ARN can't be determined at build time"
            }
        ])
    }

    private createRetrieveLeaderboardApi(props: ApiProps, functionName: string) {
        const functionRole = new Role(this, "RetrieveLeaderboardRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "lambda": PermissionGenerator.generateNetworkAwareLambdaPolicyDocument(Stack.of(this), functionName)
            }
        })

        functionRole.applyRemovalPolicy(RemovalPolicy.DESTROY)

        props.database.rds.secret!.grantRead(functionRole)

        const retrieveLeaderboardFunction = new NodejsFunction(this, "RetrieveLeaderboardFunction", {
            vpc: props.network.vpc,
            vpcSubnets: props.network.vpc.selectSubnets({
                subnetGroupName: Network.SUBNET_TYPE_APPLICATION
            }),
            runtime: Runtime.NODEJS_LATEST,
            environment: {
                RDS_SECRET_ARN: props.database.rds.secret!.secretArn,
                REDIS_ENDPOINT_ADDRESS: props.database.cache.attrRedisEndpointAddress
            },
            entry: __dirname+"/resources/app/api/retrieve-leaderboard.ts",
            depsLockFilePath: __dirname+"/resources/app/package-lock.json",
            role: functionRole,
            securityGroups: [this.apiSecurityGroup],
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
            timeout: Duration.minutes(5),
            memorySize: 128,
            functionName
        })

        retrieveLeaderboardFunction.applyRemovalPolicy(RemovalPolicy.DESTROY)

        this.httpApi.addRoutes({
            path: "/leaderboard/top10",
            methods: [
                HttpMethod.GET
            ],
            integration: new HttpLambdaIntegration("RetrieveLeaderboardLambdaIntegration", retrieveLeaderboardFunction)
        })

        NagSuppressions.addResourceSuppressions(retrieveLeaderboardFunction, [
            {
                id: "AwsSolutions-L1",
                reason: "Already using latest version"
            }
        ])

        NagSuppressions.addResourceSuppressions(functionRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Required because ARN can't be determined at build time"
            }
        ])
    }
}