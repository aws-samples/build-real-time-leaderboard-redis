// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Database, Encryption, Network } from './backend';
import { Api } from './backend/api';
import { FrontendDeployment } from './frontend/frontend-deployment';
import { NagSuppressions } from 'cdk-nag';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ElasticacheGamingLeaderboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const encryption = new Encryption(this, "Encryption")
    const network = new Network(this, "Network")
    const database = new Database(this, "Database", {
      vpc: network.vpc,
      key: encryption.key
    })

    const api = new Api(this, "Api", {
      network,
      database
    })

    const deployment = new FrontendDeployment(this, "Frontend", {api})

    new cdk.CfnOutput(this, "APIGatewayInvokeURL", {
      value: api.httpApi.apiEndpoint
    })

    new cdk.CfnOutput(this, "FrontendURL", {
      value: `https://${deployment.distribution.distributionDomainName}`
    })

    NagSuppressions.addResourceSuppressionsByPath(this, [
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource`,
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource`,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource`,
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/Resource`
      ], [
        {
            id: "AwsSolutions-IAM4",
            reason: "Part of CDK provider framework"
        },
        {
            id: "AwsSolutions-IAM5",
            reason: "Part of CDK provider framework"
        },
        {
            id: "AwsSolutions-L1",
            reason: "Part of CDK provider framework"
        }
    ])
  }
}
