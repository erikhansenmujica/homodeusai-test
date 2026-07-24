const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('usage: npm run ask -- "Como funciona o banco de horas?"');
  process.exit(2);
}

const port = Number(process.env.PORT) || 8080;
const payload = {
  requestId: `manual-${Date.now()}`,
  question,
  asOf: new Date().toISOString(),
  requester: {
    subjectId: process.env.ASK_SUBJECT || "COLAB-1042",
    legalEntityId: process.env.ASK_ENTITY || "NA_SERVICOS",
    baseId: process.env.ASK_BASE || "SUDESTE",
    relationship: process.env.ASK_RELATIONSHIP || "employee",
    role: process.env.ASK_ROLE || "consultant",
    domains: (process.env.ASK_DOMAINS || "people_ops").split(","),
  },
};

const response = await fetch(`http://127.0.0.1:${port}/v1/decide`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
