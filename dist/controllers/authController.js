"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = logout;
function logout(req, res) {
    return res.status(200).json({
        message: "Logout erfolgreich",
    });
}
