import express from "express";
import authRouter from "./routes/auth";

const app = express();

app.use(express.json());
app.use("/api/auth", authRouter);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`FactBase API läuft auf http://localhost:${PORT}`);
});