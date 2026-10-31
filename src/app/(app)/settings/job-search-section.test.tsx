import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSource } from "@/lib/job-search/search";
import type { JobSearchSettingsView } from "@/lib/job-search/sources";

import { saveJobSearchDetails, saveJobSourceKey } from "./actions";
import { JobSearchSection } from "./job-search-section";
import { setJobSourceOn, testJobSourceOf } from "./provider-actions";

vi.mock("./actions", () => ({
  saveJobSearchDetails: vi.fn(),
  saveJobSourceKey: vi.fn(),
}));
vi.mock("./provider-actions", () => ({
  setJobSourceOn: vi.fn(),
  testJobSourceOf: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const off: JobSearchSettingsView = {
  source: "OFF",
  sourcesOn: [],
  jsearch: { host: "openwebninja", keyState: "none" },
  adzuna: { appId: "", keyState: "none" },
  arbeitsagentur: { offered: true, acceptedAt: null },
  freehire: { host: "freehire.me" },
  usage: {},
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const withView = (view: Partial<JobSearchSettingsView>): JobSearchSettingsView => ({ ...off, ...view });
const on = (...sourcesOn: JobSource[]) => ({ source: sourcesOn[0] ?? ("OFF" as const), sourcesOn });
const card = (name: string) => screen.getByRole("group", { name });

beforeEach(() => {
  vi.mocked(setJobSourceOn).mockReset().mockImplementation(async ({ source }) => ({ ok: true, data: withView(on(source)) }));
  vi.mocked(saveJobSearchDetails).mockReset().mockImplementation(async ({ jsearchHost = "openwebninja", adzunaAppId = "" }) => ({
    ok: true,
    data: withView({ ...on("JSEARCH"), jsearch: { host: jsearchHost, keyState: "none" }, adzuna: { appId: adzunaAppId, keyState: "none" } }),
  }));
  vi.mocked(saveJobSourceKey).mockReset().mockResolvedValue({ ok: true, data: withView({ ...on("JSEARCH"), jsearch: { host: "openwebninja", keyState: "set" } }) });
  vi.mocked(testJobSourceOf).mockReset().mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.8 } });
});

describe("JobSearchSection", () => {
  it("has a card with a switch for each provider, all off to begin with", () => {
    render(<JobSearchSection initial={off} />);
    expect(screen.getByRole("heading", { name: "Job search" })).toBeInTheDocument();
    expect(screen.getByText(/^Where Find jobs and the job agent look for postings\. Turn on as many providers as you like; each keeps its own key, and a key only ever goes to the provider it's for\.$/)).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches.map((toggle) => toggle.getAttribute("aria-label"))).toEqual(["Use JSearch", "Use Adzuna", "Use FreeHire", "Use Bundesagentur für Arbeit"]);
    for (const toggle of switches) expect(toggle).not.toBeChecked();
    expect(screen.getByRole("group", { name: "JSearch" })).toHaveTextContent("Postings from LinkedIn, Indeed, Glassdoor");
    expect(screen.getByText("Find jobs only: the job agent never searches it.", { exact: false })).toBeInTheDocument();
    // A card that's off shows its description and switch only.
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("says that Find jobs and the agent stay off while no provider is on", () => {
    render(<JobSearchSection initial={off} />);
    expect(screen.getByRole("note")).toHaveTextContent("Find jobs and the job agent stay off until you turn a provider on.");
    expect(screen.queryByText(/go to each provider that's on/)).not.toBeInTheDocument();
  });

  it("saves a switch at once and says what's sent to the providers that are on", async () => {
    render(<JobSearchSection initial={off} />);
    await userEvent.click(screen.getByRole("switch", { name: "Use JSearch" }));
    expect(setJobSourceOn).toHaveBeenCalledWith({ source: "JSEARCH", on: true });
    expect(await screen.findByRole("switch", { name: "Use JSearch" })).toBeChecked();
    expect(screen.getByRole("note")).toHaveTextContent("Your searches (keywords, place and filters) go to each provider that's on. Nothing from your profile does.");
    expect(screen.queryByText(/stay off until you turn a provider on/)).not.toBeInTheDocument();
    expect(within(card("JSearch")).getByRole("link", { name: "OpenWeb Ninja" })).toHaveAttribute("href", "https://www.openwebninja.com/api/jsearch");

    vi.mocked(setJobSourceOn).mockResolvedValue({ ok: true, data: off });
    await userEvent.click(screen.getByRole("switch", { name: "Use JSearch" }));
    expect(setJobSourceOn).toHaveBeenLastCalledWith({ source: "JSEARCH", on: false });
    await waitFor(() => expect(screen.queryByLabelText("API key")).not.toBeInTheDocument());
  });

  it("shows the host choice and key field on JSearch's card, the App ID and key on Adzuna's, and no key for FreeHire", () => {
    render(<JobSearchSection initial={withView(on("JSEARCH", "ADZUNA", "FREEHIRE"))} />);
    expect(within(card("JSearch")).getByLabelText("API key")).toBeInTheDocument();
    expect(within(card("JSearch")).getByRole("radio", { name: "RapidAPI" })).toBeInTheDocument();
    expect(within(card("Adzuna")).getByLabelText("App ID")).toBeInTheDocument();
    expect(within(card("Adzuna")).getByLabelText("App key")).toHaveAttribute("type", "password");
    expect(within(card("FreeHire")).getByText("No key needed. Dossier searches FreeHire's public catalogue at freehire.me.")).toBeInTheDocument();
    expect(within(card("FreeHire")).queryByLabelText(/key/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Test connection" })).toHaveLength(3);
  });

  it("says which FreeHire it searches", () => {
    render(<JobSearchSection initial={withView({ ...on("FREEHIRE"), freehire: { host: "jobs.example" } })} />);
    expect(screen.getByText("No key needed. Dossier searches your own FreeHire at jobs.example.")).toBeInTheDocument();
  });

  it("saves a key when you leave the field, then forgets it in the browser", async () => {
    render(<JobSearchSection initial={withView(on("JSEARCH"))} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret");
    await userEvent.tab();
    expect(saveJobSourceKey).toHaveBeenCalledWith({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveJobSourceKey).toHaveBeenLastCalledWith({ source: "JSEARCH", change: { action: "clear" } });
  });

  it("saves a key on Enter too", async () => {
    render(<JobSearchSection initial={withView(on("JSEARCH"))} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret{Enter}");
    expect(saveJobSourceKey).toHaveBeenCalledTimes(1);
  });

  it("switches where the JSearch key is from", async () => {
    render(<JobSearchSection initial={withView(on("JSEARCH"))} />);
    await userEvent.click(screen.getByRole("radio", { name: "RapidAPI" }));
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ jsearchHost: "rapidapi" });
    expect(await screen.findByRole("link", { name: "JSearch on RapidAPI" })).toBeInTheDocument();
  });

  it("saves Adzuna's app ID when you leave it", async () => {
    vi.mocked(saveJobSearchDetails).mockResolvedValue({ ok: true, data: withView({ ...on("ADZUNA"), adzuna: { appId: "app-1", keyState: "none" } }) });
    render(<JobSearchSection initial={withView(on("ADZUNA"))} />);
    await userEvent.type(screen.getByLabelText("App ID"), "app-1");
    await userEvent.tab();
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ adzunaAppId: "app-1" });
  });

  it("shows keys from the environment and keys that can't be read", () => {
    const { unmount } = render(<JobSearchSection initial={withView({ ...on("JSEARCH"), jsearch: { host: "openwebninja", keyState: "env" } })} />);
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
    unmount();
    render(<JobSearchSection initial={withView({ ...on("JSEARCH"), jsearch: { host: "openwebninja", keyState: "unreadable" } })} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests each provider on its own card and shows its own result", async () => {
    render(<JobSearchSection initial={withView({ ...on("JSEARCH", "FREEHIRE"), jsearch: { host: "openwebninja", keyState: "set" } })} />);
    expect(within(card("JSearch")).getByRole("status")).toHaveTextContent("a test uses one search from your plan");
    await userEvent.click(within(card("FreeHire")).getByRole("button", { name: "Test connection" }));
    expect(testJobSourceOf).toHaveBeenCalledWith({ source: "FREEHIRE" });
    expect(await within(card("FreeHire")).findByText("Connected · FreeHire answered in 0.8 s")).toBeInTheDocument();
    expect(within(card("JSearch")).queryByText(/Connected/)).not.toBeInTheDocument();

    vi.mocked(testJobSourceOf).mockResolvedValue({ ok: true, data: { connected: false, message: "JSearch didn't accept your key." } });
    await userEvent.click(within(card("JSearch")).getByRole("button", { name: "Test connection" }));
    expect(testJobSourceOf).toHaveBeenLastCalledWith({ source: "JSEARCH" });
    expect(await within(card("JSearch")).findByText("JSearch didn't accept your key.")).toBeInTheDocument();
    expect(within(card("FreeHire")).getByText("Connected · FreeHire answered in 0.8 s")).toBeInTheDocument();

    vi.mocked(testJobSourceOf).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    await userEvent.click(within(card("JSearch")).getByRole("button", { name: "Test connection" }));
    expect(await within(card("JSearch")).findByText("Something went wrong on the server. Please try again.")).toBeInTheDocument();
  });

  it("resets only that card's result when something on it changes", async () => {
    vi.mocked(saveJobSearchDetails).mockResolvedValue({ ok: true, data: withView({ ...on("JSEARCH", "FREEHIRE"), jsearch: { host: "rapidapi", keyState: "none" } }) });
    render(<JobSearchSection initial={withView(on("JSEARCH", "FREEHIRE"))} />);
    await userEvent.click(within(card("FreeHire")).getByRole("button", { name: "Test connection" }));
    await userEvent.click(within(card("JSearch")).getByRole("button", { name: "Test connection" }));
    await within(card("JSearch")).findByText(/Connected/);
    await userEvent.click(within(card("JSearch")).getByRole("radio", { name: "RapidAPI" }));
    expect(await within(card("JSearch")).findByText(/Not tested since your last change/)).toBeInTheDocument();
    expect(within(card("FreeHire")).getByText(/Connected/)).toBeInTheDocument();
  });

  it("counts what was used under a provider with a quota", () => {
    render(<JobSearchSection initial={withView({ ...on("JSEARCH", "ADZUNA", "FREEHIRE"), usage: { JSEARCH: 41, ADZUNA: 7 } })} />);
    expect(within(card("JSearch")).getByText("Used in the past 30 days: 41 of 200 (counted by Dossier)")).toBeInTheDocument();
    expect(within(card("Adzuna")).getByText("Used in the past 30 days: 7 (counted by Dossier)")).toBeInTheDocument();
    expect(within(card("FreeHire")).queryByText(/Used in the past/)).not.toBeInTheDocument();
  });

  it("turns the Bundesagentur für Arbeit on only once its note is ticked (#223)", async () => {
    vi.mocked(setJobSourceOn).mockResolvedValue({ ok: true, data: withView({ ...on("ARBEITSAGENTUR"), arbeitsagentur: { offered: true, acceptedAt: ACCEPTED } }) });
    render(<JobSearchSection initial={off} />);
    await userEvent.click(screen.getByRole("switch", { name: "Use Bundesagentur für Arbeit" }));
    expect(setJobSourceOn).not.toHaveBeenCalled();
    expect(screen.getByText(/has no official API\. Dossier searches it through the access its own job search uses, without its permission/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /The BA's terms of use/ })).toHaveAttribute("href", "https://www.arbeitsagentur.de/datei/nutzungsbedingungen_ba036575.pdf");
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" }));
    expect(setJobSourceOn).toHaveBeenCalledWith({ source: "ARBEITSAGENTUR", on: true, accepted: true });
    // Saved: the note stays, without the box, and it can be tested.
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/has no official API/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
  });

  it("asks people who turned the Bundesagentur on before to tick the note too", () => {
    render(<JobSearchSection initial={withView(on("ARBEITSAGENTUR"))} />);
    expect(screen.getByRole("switch", { name: "Use Bundesagentur für Arbeit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  it("leaves the Bundesagentur out when the server doesn't offer it", () => {
    render(<JobSearchSection initial={withView({ arbeitsagentur: { offered: false, acceptedAt: null } })} />);
    expect(screen.getAllByRole("switch").map((toggle) => toggle.getAttribute("aria-label"))).toEqual(["Use JSearch", "Use Adzuna", "Use FreeHire"]);
  });
});
