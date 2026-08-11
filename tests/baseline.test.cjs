const assert = require("node:assert/strict");
const test = require("node:test");

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
  const originalPort = process.env.PORT;
  const serverPath = require.resolve("../dist/server");
  const listenCalls = [];

  app.listen = (...args) => {
    listenCalls.push(args);
  };

  try {
    delete process.env.PORT;
    delete require.cache[serverPath];
    require(serverPath);

    process.env.PORT = "4317";
    delete require.cache[serverPath];
    require(serverPath);

    assert.equal(listenCalls.length, 2);
    assert.equal(listenCalls[0][0], 3000);
    assert.equal(typeof listenCalls[0][1], "function");
    assert.equal(listenCalls[1][0], 4317);
    assert.equal(typeof listenCalls[1][1], "function");
  } finally {
    delete require.cache[serverPath];
    app.listen = originalListen;

    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  }
});

test("compiled Express app exposes the existing POST /api/auth/logout baseline", () => {
  const app = require("../dist/app").default;
  const headers = {};
  const request = {
    method: "POST",
    url: "/api/auth/logout",
    headers: {},
  };
  const response = {
    statusCode: undefined,
    body: undefined,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name) {
      delete headers[name.toLowerCase()];
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let dispatchError;

  app.handle(request, response, (error) => {
    dispatchError = error ?? new Error("request was not handled");
  });

  assert.equal(dispatchError, undefined);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { message: "Logout erfolgreich" });
});
