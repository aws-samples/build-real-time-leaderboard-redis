// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { RemovalPolicy } from "aws-cdk-lib";
import { IKey, Key } from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export class Encryption extends Construct {
    readonly key: IKey

    constructor(scope: Construct, id: string) {
        super(scope, id)

        this.key = new Key(this, "EncryptionKey", {
            removalPolicy: RemovalPolicy.DESTROY,
            enableKeyRotation: true
        })
    }
}