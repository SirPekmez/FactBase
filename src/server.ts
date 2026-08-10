import app from "./app";

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`FactBase API läuft auf http://localhost:${PORT}`);
});
