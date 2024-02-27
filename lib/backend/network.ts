// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { RemovalPolicy } from "aws-cdk-lib";
import { IVpc, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export class Network extends Construct {
    public static readonly SUBNET_TYPE_PUBLIC = "public"
    public static readonly SUBNET_TYPE_APPLICATION = "application"
    public static readonly SUBNET_TYPE_DATABASE = "database"
    
    readonly vpc: IVpc

    constructor(scope: Construct, id: string) {
        super(scope, id)

        this.vpc = new Vpc(this, "BackendNetwork", {
            maxAzs: 3,
            subnetConfiguration: [
                {
                    name: "public",
                    subnetType: SubnetType.PUBLIC
                },
                {
                    name: "application",
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS
                },
                {
                    name: "database",
                    subnetType: SubnetType.PRIVATE_ISOLATED
                }
            ],
            flowLogs: {
                "default": {

                }  
            }
        })

        this.vpc.applyRemovalPolicy(RemovalPolicy.DESTROY)

        NagSuppressions.addResourceSuppressions(this.vpc, [
            {
                id: "AwsSolutions-VPC7",
                reason: "Flow logs not needed for this specific demo."
            }
        ])
    }
}