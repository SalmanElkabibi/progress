import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

async function ensureDatabase() {
  const temp = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  });
  await temp.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
  await temp.end();

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin','viewer') DEFAULT 'viewer',
    name VARCHAR(100) NOT NULL
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS table_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    module VARCHAR(255),
    menu VARCHAR(255),
    sous_menu VARCHAR(255),
    page INT,
    page_executer INT,
    backend_logique INT
  )`);

  return db;
}

async function seedUsers(db) {
  const [rows] = await db.execute("SELECT COUNT(*) as count FROM users");
  if (rows[0].count === 0) {
    const adminPass = await bcrypt.hash("M8F3wf6YWmaV", 10);
    const userPass = await bcrypt.hash("L4OYhNiX1e87", 10);
    await db.query(
      "INSERT INTO users (email, password, role, name) VALUES (?, ?, 'admin', ?), (?, ?, 'viewer', ?)",
      ["admin@g-innovation.com", adminPass, "Administrateur", "user@g-innovation.com", userPass, "Utilisateur"]
    );
  }
}

async function seedTableData(db) {
  const [rows] = await db.execute("SELECT COUNT(*) as count FROM table_data");
  if (rows[0].count > 0) return;

  const jsPath = path.join(__dirname, "public", "table_data_embed.js");
  if (!fs.existsSync(jsPath)) return;

  const raw = fs.readFileSync(jsPath, "utf8");
  const match = raw.match(/\[([\s\S]*)\]/);
  if (!match) return;

  let tableData;
  try {
    const jsonStr = `[${match[1]}]`;
    tableData = eval(jsonStr);
  } catch {
    return;
  }
  if (!Array.isArray(tableData) || tableData.length === 0) return;

  const values = tableData.map(r => [
    r.module || null,
    r.menu || null,
    r.sous_menu || null,
    r.page || null,
    r.page_executer || null,
    r.backend_logique || null
  ]);

  await db.query(
    "INSERT INTO table_data (module, menu, sous_menu, page, page_executer, backend_logique) VALUES ?",
    [values]
  );
}

const db = await ensureDatabase();

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    res.json({ success: true, user: { email: user.email, role: user.role, name: user.name } });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM table_data ORDER BY id ASC");
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Erreur lors du chargement des données" });
  }
});

app.post("/api/data", async (req, res) => {
  const { module, menu, sous_menu, page, page_executer, backend_logique } = req.body;
  try {
    const [r] = await db.execute(
      "INSERT INTO table_data (module, menu, sous_menu, page, page_executer, backend_logique) VALUES (?, ?, ?, ?, ?, ?)",
      [module || null, menu || null, sous_menu || null, page || null, page_executer || null, backend_logique || null]
    );
    const [rows] = await db.execute("SELECT * FROM table_data WHERE id=?", [r.insertId]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Erreur lors de l'ajout" });
  }
});

app.put("/api/data/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { page, page_executer, backend_logique } = req.body || {};
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID invalide" });
  try {
    await db.execute(
      "UPDATE table_data SET page=?, page_executer=?, backend_logique=? WHERE id=?",
      [page ?? null, page_executer ?? null, backend_logique ?? null, id]
    );
    const [rows] = await db.execute("SELECT * FROM table_data WHERE id=?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Ligne introuvable" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Erreur lors de la mise à jour" });
  }
});

app.post("/api/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.json({ imported: 0 });
  try {
    const values = rows.map(r => [
      r.module || null,
      r.menu || null,
      r.sous_menu || null,
      r.page || null,
      r.page_executer || null,
      r.backend_logique || null
    ]);
    await db.query(
      "INSERT INTO table_data (module, menu, sous_menu, page, page_executer, backend_logique) VALUES ?",
      [values]
    );
    res.json({ imported: values.length });
  } catch {
    res.status(500).json({ error: "Erreur lors de l'import" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await seedUsers(db);
  await seedTableData(db);
  console.log(`Server running on http://localhost:${PORT}`);
});
