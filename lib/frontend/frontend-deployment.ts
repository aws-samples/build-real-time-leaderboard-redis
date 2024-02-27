// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { RemovalPolicy } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, DeployTimeSubstitutedFile, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { Api } from "../backend/api";
import { CloudFrontAllowedMethods, CloudFrontWebDistribution, Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { createHash } from "crypto";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";

export interface FrontendDeploymentProps {
    api: Api
}

export class FrontendDeployment extends Construct {
    readonly distribution

    constructor(scope: Construct, id: string, props: FrontendDeploymentProps) {
        super(scope, id)

        const bucket = new Bucket(this, "FrontendBucket", {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL
        })

        NagSuppressions.addResourceSuppressions(bucket, [
            {
                id: "AwsSolutions-S1",
                reason: "Demo purposes only"
            },
            {
                id: "AwsSolutions-S10",
                reason: "Demo purposes only. Only contains static frontend files."
            }
        ], true)

        const deployment = new BucketDeployment(this, "FrontendDeployment", {
            sources: [Source.asset(__dirname+"/resources")],
            destinationBucket: bucket,
            exclude: ["index.html"]
        })

        deployment.node.addDependency(bucket)

        const deployIndex = new DeployTimeSubstitutedFile(this, "FrontendDeployIndex", {
            source: __dirname+"/resources/index.html",
            destinationBucket: bucket,
            substitutions: {
                "apiBaseUrl": props.api.httpApi.apiEndpoint
            }
        })

        deployIndex.node.addDependency(props.api.httpApi)

        const renameCr = new AwsCustomResource(this, "RenameUploadedIndex", {
            onCreate: {
                service: "s3",
                action: "copyObject",
                parameters: {
                    "Bucket": bucket.bucketName,
                    "CopySource": `${bucket.bucketName}/${deployIndex.objectKey}`,
                    "Key": "index.html",
                    "ContentType": "text/html",
                    "MetadataDirective": "REPLACE"
                },
                physicalResourceId: PhysicalResourceId.of(`renameUploadCreate-${createHash("sha256").update(deployIndex.objectKey).digest('hex')}`)
            },
            policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "s3:ListBucket"
                    ],
                    resources: [
                        bucket.bucketArn
                    ]
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "s3:GetObject",
                        "s3:GetObjectTagging",
                        "s3:PutObject",
                        "s3:PutObjectTagging"
                    ],
                    resources: [
                        bucket.arnForObjects("*")
                    ]
                })
            ])
        })

        NagSuppressions.addResourceSuppressions(renameCr, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Requires dynamic permission because of dynamically generated key."
            }
        ], true)

        renameCr.node.addDependency(deployIndex)
        renameCr.node.addDependency(props.api.httpApi)

        const oai = new OriginAccessIdentity(this, "HostingOAI")
        this.distribution = new CloudFrontWebDistribution(this, "FrontendDistribution", {
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: bucket,
                        originAccessIdentity: oai
                    },
                    behaviors: [
                        {
                            isDefaultBehavior: true,
                            allowedMethods: CloudFrontAllowedMethods.ALL
                        }
                    ]
                }
            ],
            defaultRootObject: "index.html"
        })

        this.distribution.applyRemovalPolicy(RemovalPolicy.DESTROY)

        NagSuppressions.addResourceSuppressions(this.distribution, [
            {
                id: "AwsSolutions-CFR3",
                reason: "Demo purposes only"
            },
            {
                id: "AwsSolutions-CFR4",
                reason: "Demo purposes only"
            }
        ])
    }
}