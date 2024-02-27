// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } from "@aws-sdk/client-codebuild"

export const handler = async(event) => {
    const requestType = event["RequestType"]

    if (requestType === "Create") {
        const projectName = process.env.PROJECT_NAME

        const client = new CodeBuildClient()
        const startBuildResp = await client.send(new StartBuildCommand({
            projectName
        }))

        return {
            "Data": {
                "buildId": startBuildResp.build.id
            }
        }
    }

    return
}

export const completeHandler = async(event) => {
    const requestType = event["RequestType"]

    if (requestType === "Create") {
        const client = new CodeBuildClient()
        const buildId = event.Data.buildId
        const builds = await client.send(new BatchGetBuildsCommand({ids: [buildId]}))

        const ongoing = builds.builds[0]

        return {
            "IsComplete": ongoing.buildComplete
        }
    }

    return {
        "IsComplete": true
    }
}