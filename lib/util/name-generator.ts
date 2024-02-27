// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { Names } from "aws-cdk-lib";
import { Construct } from "constructs";

export class NameGenerator {
    public static generate(scope: Construct, prefix: string, maxLength?: number, separator?: string): string {
        const actualMaxLength = maxLength ?? 64
        const actualSeparator = separator ?? "_"
        
        return prefix + actualSeparator + Names.uniqueResourceName(scope, {
            maxLength: actualMaxLength - prefix.length - 2
        })
    }
}