import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openReadyWorkbench(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("submit-decision")).toBeEnabled();
  await expect(page.locator("#service-state")).toHaveAttribute("data-state", "ok");
}

async function submitQuestion(page: Page, question: string): Promise<void> {
  const input = page.getByTestId("question-input");
  await input.fill(question);
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/v1/decide") && response.request().method() === "POST"),
    input.press("Enter"),
  ]);
}

test("real backend answers a referential follow-up without moving the viewport", async ({ page }) => {
  await openReadyWorkbench(page);
  let releaseAnswer: (() => void) | undefined;
  const answerGate = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  await page.route("**/v1/decide", async (route) => {
    const response = await route.fetch();
    await answerGate;
    await route.fulfill({ response });
  });
  const input = page.getByTestId("question-input");
  await input.fill("Qual é o valor diário do apoio de refeição aplicável a mim?");
  await input.press("Enter");
  await expect(page.locator("#progress-state")).toBeVisible();
  const before = await page.evaluate(() => window.scrollY);
  releaseAnswer?.();
  await expect(page.getByTestId("claims-panel")).toContainText("R$ 47,30");
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(16);
  await page.unroute("**/v1/decide");
  await expect(page.locator(".score-explanation")).toContainText("não é probabilidade de verdade");

  const followup = page.locator(".decision-card[aria-current='true'] .followup textarea");
  await followup.fill("Esse valor também é pago em dias em que eu não trabalho?");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/v1/decide") && response.request().method() === "POST"),
    page.locator(".decision-card[aria-current='true'] .followup button[type='submit']").click(),
  ]);
  await expect(page.locator(".decision-card[aria-current='true']")).toContainText("Ausência integral não gera o lançamento");
  await expect(page.locator(".decision-card[aria-current='true'] [data-kind='answer']")).toBeVisible();
  if (process.env.UPDATE_SCREENSHOTS === "1") {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "screenshots/desktop-decision.jpg",
      fullPage: true,
      quality: 85,
      type: "jpeg",
    });
    const activeDecisionId = await page.locator(".decision-card[aria-current='true']").getAttribute("data-decision-id");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#decision-${activeDecisionId}`);
    await expect(page.locator(".decision-card[aria-current='true']")).toContainText(
      "Ausência integral não gera o lançamento"
    );
    await expect(page.getByTestId("source-inventory")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("source-inventory")).toBeHidden();
    await page.locator(".decision-card[aria-current='true']").evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
    await page.screenshot({
      path: "screenshots/mobile-decision.jpg",
      quality: 85,
      type: "jpeg",
    });
  }
});

test("source navigation remains inside the workbench and restores the decision", async ({ page }) => {
  await openReadyWorkbench(page);
  await page.evaluate(() => history.replaceState({}, "", "/#landing-sentinel"));
  await submitQuestion(page, "Qual é o valor diário do apoio de refeição aplicável a mim?");
  const activeCard = page.locator(".decision-card[aria-current='true']");
  const question = await activeCard.locator(".decision-card-head h2").textContent();
  await activeCard.getByTestId("evidence-source-link").first().click();
  await expect(page).toHaveURL(/\/sources\/[^/]+\/[^/?]+/u);
  await expect(page.getByTestId("source-detail")).toContainText("Conteúdo disponível");
  await expect(page.locator("#evidence-highlight")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("source-detail")).toContainText("Conteúdo disponível");
  await expect(page.locator("#evidence-highlight")).toBeVisible();
  await expect(page.locator(".decision-card[aria-current='true'] .decision-card-head h2")).toHaveText(question ?? "");

  await page.getByRole("link", { name: "Voltar à decisão" }).click();
  await expect(page).toHaveURL(/\/#decision-/u);
  await expect(activeCard.locator(".decision-card-head h2")).toHaveText(question ?? "");
  await expect(page.getByTestId("source-inventory")).not.toHaveClass(/is-expanded/u);
});

test("handoff receipt, canonical resolution, and trace work against the real backend", async ({ page }) => {
  await openReadyWorkbench(page);
  await submitQuestion(page, "Quero falar com uma pessoa.");
  await expect(page.getByTestId("handoff-panel")).toContainText("Aberto");

  await page.getByTestId("handoff-open").click();
  await expect(page.getByTestId("handoff-record")).toContainText("Pedido original");
  await page.getByTestId("handoff-resolution-summary").fill(
    "Solicitante contatado e próximo passo validado pela equipe responsável."
  );
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/resolve")),
    page.getByTestId("handoff-resolve").click(),
  ]);
  await expect(page.getByTestId("handoff-resolved-state")).toContainText("Resolução canônica");

  await page.getByTestId("trace-trigger").click();
  await expect(page.getByTestId("trace-panel")).toContainText("Etapas registradas");
  await expect(page.getByTestId("trace-panel")).toContainText("Roteamento terminal");
  await page.reload();
  await expect(page.getByTestId("handoff-resolved-state")).toContainText("Resolução canônica");
  await expect(page.getByTestId("trace-panel")).toContainText("Roteamento terminal");
});

test("conversational, slow, failure, and retry states remain distinct", async ({ page }) => {
  await openReadyWorkbench(page);
  await submitQuestion(page, "Obrigado!");
  await expect(page.locator(".decision-card[aria-current='true'] [data-kind='conversational']")).toBeVisible();

  await page.getByRole("button", { name: /Nova decisão/u }).first().click();
  let releaseSlow: (() => void) | undefined;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  await page.route("**/v1/decide", async (route) => {
    await slowGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ kind: "conversational", body: "Resposta simulada.", traceId: "trace-slow0000" }),
    });
  });
  await page.getByTestId("question-input").fill("Uma consulta lenta");
  await page.getByTestId("submit-decision").click();
  await expect(page.locator("#progress-state")).toBeVisible();
  await expect(page.locator("#slow-message")).toBeVisible({ timeout: 6_000 });
  releaseSlow?.();
  await expect(page.locator(".decision-card[aria-current='true']")).toContainText("Resposta simulada");
  await page.unroute("**/v1/decide");

  await page.getByRole("button", { name: /Nova decisão/u }).first().click();
  let attempts = 0;
  await page.route("**/v1/decide", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"runtime_unavailable"}' });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ kind: "conversational", body: "Recuperado com segurança.", traceId: "trace-retry000" }),
      });
    }
  });
  await page.getByTestId("question-input").fill("Teste de recuperação");
  await page.getByTestId("submit-decision").click();
  await expect(page.getByTestId("error-state")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.locator(".decision-card[aria-current='true']")).toContainText("Recuperado com segurança");
  expect(attempts).toBe(2);
});

test("mobile source drawer is a trapped, dismissible dialog with no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyWorkbench(page);
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const trigger = page.locator("#mobile-source-trigger");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Fontes da decisão" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".main-stage")).toHaveAttribute("inert", "");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() =>
    Boolean(document.activeElement?.closest("#source-inventory")))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("source-inventory")).toHaveAttribute("aria-hidden", "true");
  await expect(trigger).toBeFocused();
  await expect(page.locator("#source-backdrop")).toBeHidden();
});

test("restricted source bodies never enter DOM, storage, logs, or rendered errors", async ({ page }) => {
  const protectedBody = "PROTECTED_BODY_MUST_NEVER_RENDER_9c4d";
  const browserMessages: string[] = [];
  page.on("console", (message) => browserMessages.push(message.text()));
  await openReadyWorkbench(page);
  await page.route("**/api/sources/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access: "restricted",
        message: "Conteúdo protegido.",
        content: protectedBody,
        metadata: {
          sourceId: "restricted-test",
          versionId: "1",
          title: "Fonte restrita de teste",
          sourceType: "policy",
          domain: "personal_data",
          approval: "approved",
          audience: "restricted",
          authorityTier: 100,
          policySensitivity: "sensitive",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          eligibility: { legalEntityIds: [], baseIds: [], relationships: [], roles: [] },
          extractionMode: "structured",
          originalFormat: "PDF",
          contentBytes: protectedBody.length
        }
      }),
    });
  });
  await page.goto("/sources/restricted-test/1");
  await expect(page.getByTestId("source-detail")).toContainText("Acesso governado");
  await expect(page.locator("body")).not.toContainText(protectedBody);
  const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(storage).not.toContain(protectedBody);
  expect(browserMessages.join("\n")).not.toContain(protectedBody);
  await expect(page.getByTestId("error-state")).not.toContainText(protectedBody);
});

test("workbench has no serious accessibility violations", async ({ page }) => {
  await openReadyWorkbench(page);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
});
