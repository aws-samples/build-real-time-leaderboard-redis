// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { Stack } from "aws-cdk-lib";
import { Effect, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";

export class PermissionGenerator {
    public static generateNonVPCAwareLambdaPolicyDocument(stack: Stack, functionName: string): PolicyDocument {
        const logGroup = `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/${functionName}`
        const logStream = `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/${functionName}:log-stream:*`

        return new PolicyDocument({
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "logs:CreateLogGroup"
                    ],
                    resources: [
                        logGroup
                    ]
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    resources: [
                        logStream
                    ]
                })
            ]
        })
    }
    
    public static generateNetworkAwareLambdaPolicyDocument(stack: Stack, functionName: string): PolicyDocument {
        const policyDocument = PermissionGenerator.generateNonVPCAwareLambdaPolicyDocument(stack, functionName)

        policyDocument.addStatements(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    "ec2:CreateNetworkInterface",
                    "ec2:DescribeNetworkInterfaces",
                    "ec2:DescribeSubnets",
                    "ec2:DeleteNetworkInterface",
                    "ec2:AssignPrivateIpAddresses",
                    "ec2:UnassignPrivateIpAddresses"
                ],
                resources: [
                    "*"
                ]
            })
        )

        return policyDocument
    }
}