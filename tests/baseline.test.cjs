const assert = require("node:assert/strict");
const test = require("node:test");
const authRouter = require("../dist/routes/auth").default;

test("compiled Express app can be imported without starting a listener", () => {
  const express = require("express");
  const originalListen = express.application.listen;
  let listenCallCount = 0;

  express.application.listen = function () {
    listenCallCount += 1;
  };

  try {
    delete require.cache[require.resolve("../dist/app")];
    const app = require("../dist/app").default;

    assert.equal(typeof app, "function");
    assert.equal(listenCallCount, 0);
  } finally {
    express.application.listen = originalListen;
  }
});

test("compiled process bootstrap starts the existing app listener", () => {
  const app = require("../dist/app").default;
  const originalListen = app.listen;
  const listenCalls = [];

  app.listen = (...args) => {
    listenCalls.push(args);
  };

  try {
    delete require.cache[require.resolve("../dist/server")];
    require("../dist/server");

    assert.equal(listenCalls.length, 1);
    assert.equal(listenCalls[0][0], 3000);
    assert.equal(typeof listenCalls[0][1], "function");
  } finally {
    app.listen = originalListen;
  }
});

test("compiled auth router exposes the existing POST /logout baseline", () => {
  const logoutRoute = authRouter.stack.find(
    (layer) => layer.route?.path === "/logout",
  );

  assert.ok(logoutRoute, "expected the existing /logout route");
  assert.equal(logoutRoute.route.methods.post, true);

  const logoutHandler = logoutRoute.route.stack.find(
    (layer) => layer.method === "post",
  ).handle;
  const response = {
    statusCode: undefined,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  const result = logoutHandler({}, response);

  assert.equal(result, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { message: "Logout erfolgreich" });
});
