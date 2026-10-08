import { App } from "aws-cdk-lib";
import { CheckInsStack, parseStage } from "../lib/checkins-stack";

const app = new App();
const stage = parseStage(app.node.tryGetContext("stage"));

new CheckInsStack(app, `EnergyMeCheckIns-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  terminationProtection: stage === "prod",
});
