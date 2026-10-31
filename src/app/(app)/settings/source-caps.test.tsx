import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentSearch } from "@/lib/agent/search-schema";
import { EMPTY_QUERY } from "@/lib/job-search/search";

import { saveSourceCap } from "../agent/search-actions";
import { SourceCaps } from "./source-caps";

vi.mock("../agent/search-actions", () => ({ saveSourceCap: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const search = (id: string, name: string, patch: Partial<AgentSearch> = {}): AgentSearch => ({ ...EMPTY_QUERY, keywords: name, country: "nl", id, name, enabled: true, ...patch });
const row = (name: string) => within(screen.getByRole("group", { name }));
const open = (props: Partial<Parameters<typeof SourceCaps>[0]> = {}) =>
  render(
    <SourceCaps
      sources={["JSEARCH", "ADZUNA", "FREEHIRE"]}
      initial={{ JSEARCH: 2 }}
      searches={[search("a", "Product designer"), search("b", "Data analyst")]}
      runs={[]}
      timeZone="UTC"
      {...props}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe("Searches per provider, each day", () => {
  it("offers the caps, with what they come to in a month", async () => {
    const user = userEvent.setup();
    open();
    const jsearch = row("JSearch").getByLabelText("At most");
    expect(within(jsearch).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Not used by the agent",
      "1 a day",
      "2 a day",
      "3 a day",
      "4 a day",
      "5 a day",
      "Every search",
    ]);
    expect(jsearch).toHaveValue("2");
    expect(jsearch).toHaveAccessibleDescription("About 60 a month of your 200");
    expect(row("Adzuna").getByLabelText("At most")).toHaveValue("all");
    expect(row("Adzuna").getByLabelText("At most")).toHaveAccessibleDescription("About 250 a day on a free key.");
    expect(row("FreeHire").getByLabelText("At most")).toHaveAccessibleDescription("No quota.");
    await user.selectOptions(row("Adzuna").getByLabelText("At most"), "3 a day");
    expect(row("Adzuna").getByLabelText("At most")).toHaveAccessibleDescription("About 90 a month");
  });

  it("saves a cap at once, as a number or all", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(row("JSearch").getByLabelText("At most"), "5 a day");
    expect(saveSourceCap).toHaveBeenLastCalledWith({ source: "JSEARCH", cap: 5 });
    await user.selectOptions(row("JSearch").getByLabelText("At most"), "Every search");
    expect(saveSourceCap).toHaveBeenLastCalledWith({ source: "JSEARCH", cap: "all" });
    await user.selectOptions(row("JSearch").getByLabelText("At most"), "Not used by the agent");
    expect(saveSourceCap).toHaveBeenLastCalledWith({ source: "JSEARCH", cap: 0 });
  });

  it("switches back when a cap isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(saveSourceCap).mockResolvedValueOnce({ ok: false, error: "No." });
    open();
    await user.selectOptions(row("JSearch").getByLabelText("At most"), "5 a day");
    await vi.waitFor(() => expect(row("JSearch").getByLabelText("At most")).toHaveValue("2"));
  });

  it("previews the next run on all providers when nothing is capped", () => {
    open({ initial: {} });
    expect(screen.getByText("Next run: Product designer and Data analyst on all 3.")).toBeInTheDocument();
  });

  it("previews which providers get which searches when one is capped", () => {
    open({ initial: { JSEARCH: 1 } });
    expect(screen.getByText("Next run: Product designer and Data analyst on Adzuna and FreeHire, and Product designer on JSearch.")).toBeInTheDocument();
  });

  it("follows today's runs in the user's time zone, and says which searches are paused", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    // 06:00 UTC: earlier today in UTC, but yesterday evening in Los Angeles.
    const runs = [{ at: "2026-10-29T06:00:00Z", manual: false, message: null, requests: [{ source: "JSEARCH" as const, searchId: "a" }] }];
    const searches = [search("a", "Product designer"), search("b", "Data analyst"), search("c", "Writer", { enabled: false })];
    try {
      const { unmount } = open({ initial: { JSEARCH: 1 }, runs, searches });
      expect(screen.getByText("Next run: Product designer and Data analyst on Adzuna and FreeHire. Writer is paused.")).toBeInTheDocument();
      unmount();
      open({ initial: { JSEARCH: 1 }, runs, searches, timeZone: "America/Los_Angeles" });
      expect(screen.getByText("Next run: Product designer and Data analyst on Adzuna and FreeHire, and Data analyst on JSearch. Writer is paused.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when nothing will be searched", () => {
    open({ searches: [search("c", "Writer", { enabled: false })] });
    expect(screen.getByText("Next run: nothing to search. Writer is paused.")).toBeInTheDocument();
  });
});
