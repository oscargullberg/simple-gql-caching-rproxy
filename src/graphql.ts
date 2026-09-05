import { getOperationAST, parse } from "graphql";

type GraphqlRequestBody = {
  operationName?: unknown;
  query?: unknown;
};

const MAX_GRAPHQL_TOKENS = 10_000;

export const isCacheableGraphqlRequest = (body: string): boolean => {
  try {
    const payload = JSON.parse(body) as GraphqlRequestBody;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    if (typeof payload.query !== "string") {
      return false;
    }
    if (
      payload.operationName !== undefined &&
      typeof payload.operationName !== "string"
    ) {
      return false;
    }

    const operationName =
      typeof payload.operationName === "string"
        ? payload.operationName
        : undefined;
    const document = parse(payload.query, {
      maxTokens: MAX_GRAPHQL_TOKENS,
      noLocation: true,
    });
    return getOperationAST(document, operationName)?.operation === "query";
  } catch {
    return false;
  }
};

export const isCacheableGraphqlResponse = (body: Buffer): boolean => {
  try {
    const payload = JSON.parse(body.toString("utf8")) as Record<
      string,
      unknown
    >;
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "data" in payload &&
      (!("errors" in payload) ||
        (Array.isArray(payload.errors) && payload.errors.length === 0)) &&
      payload.hasNext !== true
    );
  } catch {
    return false;
  }
};
