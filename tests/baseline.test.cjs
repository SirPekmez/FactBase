const assert = require("node:assert/strict");
const test = require("node:test");
const authRouter = require("../dist/routes/auth").default;

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
