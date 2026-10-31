import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { saveAgentSettings } from "../agent/actions";
import { AgentSection, type AgentSettings } from "./agent-section";

vi.mock("../agent/actions", () => ({ saveAgentSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("../agent/search-actions", () => ({ addAgentSearch: vi.fn(), updateAgentSearch: vi.fn(), removeAgentSearch: vi.fn(), saveSourceCap: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const initial: AgentSettings = {
  enabled: false,
  searches: [{ id: "a", name: "Data scientist", keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any", enabled: true }],
  caps: { JSEARCH: 2 },
  hour: 7,
  minScore: 70,
  maxScores: 15,
  maxDrafts: 3,
  autoDraft: false,
};
const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (props: Partial<Parameters<typeof AgentSection>[0]> = {}) =>
  render(<AgentSection initial={initial} sources={["JSEARCH"]} runs={[]} scoring={{ scorer: "AI", ready: true }} countries={countries} timeZone="Europe/Berlin" {...props} />);

beforeEach(() => vi.clearAllMocks());

describe("Settings → Job agent (E16-7)", () => {
  it("says what it does in plain words", () => {
    open();
    expect(
      screen.getByText("Once a day it runs each of your saved searches on every provider that's on, scores the new postings against your profile, and keeps the best on the Agent screen. It never sends or applies."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved searches" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Searches per provider, each day" })).toBeInTheDocument();
  });

  it("is off until it's turned on", async () => {
    const user = userEvent.setup();
    open();
    const toggle = screen.getByRole("switch", { name: "Run the job agent" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. Nothing is searched or scored until it's on.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenCalledWith({ enabled: true });
    expect(toggle).toHaveAccessibleDescription(/^On\. It runs once a day after 07:00 your time \(Europe\/Berlin\)/);
  });

  it("stays off and says why when no saved search is on", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAgentSettings).mockResolvedValueOnce({ ok: false, error: "Add a saved search and turn it on before turning the agent on." });
    open({ initial: { ...initial, searches: [] } });
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false"));
    expect(toast).toHaveBeenCalledWith("Add a saved search and turn it on before turning the agent on.");
  });

  it("saves the other choices at once", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Runs after"), "09:00");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ hour: 9 });
    await user.selectOptions(screen.getByLabelText("Minimum score"), "80 of 100");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ minScore: 80 });
    await user.selectOptions(screen.getByLabelText("Postings scored per run"), "20");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxScores: 20 });
  });

  it("prepares no drafts on its own unless asked, and then up to the cap", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText("Drafts per run, at most")).toBeDisabled();
    const toggle = screen.getByRole("switch", { name: "Prepare drafts on its own" });
    expect(toggle).toHaveAccessibleDescription("Off. You choose which postings get a draft with Prepare draft.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ autoDraft: true });
    await user.selectOptions(screen.getByLabelText("Drafts per run, at most"), "5");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxDrafts: 5 });
    expect(toggle).toHaveAccessibleDescription(/up to 5 drafts/);
  });

  it("explains the limits in plain words", () => {
    open();
    expect(screen.getByText(/^One run a day, and at most three in any 24 hours\. Each run scores up to 15 postings\./)).toHaveTextContent(
      "job providers only get the searches.",
    );
  });

  it("points to Settings → Job search while no provider is on for the agent", () => {
    open({ sources: [] });
    expect(screen.getByRole("note")).toHaveTextContent("The agent searches the providers you turn on in Settings → Job search, and none is on yet.");
    expect(screen.getByRole("link", { name: "Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
  });

  it("points to the AI provider while it isn't set up", () => {
    open({ scoring: { scorer: "AI", ready: false } });
    expect(screen.getByRole("note")).toHaveTextContent("The agent scores postings with the AI provider in Settings → AI provider, which isn't set up yet. Choose one first.");
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });

  it("asks for the TypeSafe key when Jev scores without one (#274)", () => {
    open({ scoring: { scorer: "JEV", ready: false } });
    expect(screen.getByRole("note")).toHaveTextContent("The agent scores postings with Jev, which needs your TypeSafe key in Settings → Scoring.");
    expect(screen.getByRole("link", { name: "Settings → Scoring" })).toHaveAttribute("href", "/settings?section=scoring");
  });

  it("switches back and says why when a change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAgentSettings).mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    open();
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false"));
    expect(toast).toHaveBeenCalledWith("Something went wrong.");
  });
});
