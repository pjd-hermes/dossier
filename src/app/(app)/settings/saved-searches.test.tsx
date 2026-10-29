import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentSearch } from "@/lib/agent/search-schema";
import { EMPTY_QUERY } from "@/lib/job-search/search";

import { addAgentSearch, removeAgentSearch, updateAgentSearch } from "../agent/search-actions";
import { SavedSearches } from "./saved-searches";

vi.mock("../agent/search-actions", () => ({
  addAgentSearch: vi.fn(),
  updateAgentSearch: vi.fn(),
  removeAgentSearch: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const search = (id: string, name: string, patch: Partial<AgentSearch> = {}): AgentSearch => ({
  ...EMPTY_QUERY,
  keywords: name,
  country: "nl",
  place: "Rotterdam",
  id,
  name,
  enabled: true,
  ...patch,
});
const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (initial: AgentSearch[], onChange = vi.fn()) =>
  render(<SavedSearches initial={initial} sources={["JSEARCH", "ADZUNA"]} countries={countries} onChange={onChange} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateAgentSearch).mockImplementation(async ({ id, changes }) => ({ ok: true, data: { ...search(id, "x"), ...changes } }));
});

describe("Saved searches", () => {
  it("says which providers run them, and lists each search with a summary", () => {
    open([search("a", "Product designer"), search("b", "Data analyst", { place: "", enabled: false })]);
    expect(screen.getByText("One per job type. Each runs on JSearch and Adzuna. Postings you saved, dismissed or applied for are left out.")).toBeInTheDocument();
    expect(screen.getByText("Product designer · Rotterdam · Netherlands")).toBeInTheDocument();
    expect(screen.getByText("Data analyst · Netherlands · paused")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Run Product designer" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Run Data analyst" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
  });

  it("opens a new search for editing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.mocked(addAgentSearch).mockResolvedValue({ ok: true, data: { ...EMPTY_QUERY, id: "n", name: "New search", enabled: false } });
    open([search("a", "Product designer")], onChange);
    await user.click(screen.getByRole("button", { name: "Add a search" }));
    expect(await screen.findByLabelText("Name")).toHaveValue("New search");
    expect(screen.getByLabelText("What")).toHaveValue("");
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "n" })]);
  });

  it("shows no provider hint on the fields", async () => {
    const user = userEvent.setup();
    open([search("a", "Product designer", { remoteOnly: true })]);
    await user.click(screen.getByRole("button", { name: "Edit Product designer" }));
    expect(screen.queryByText(/has no remote filter/)).not.toBeInTheDocument();
    expect(screen.queryByText(/has no distance filter/)).not.toBeInTheDocument();
  });

  it("saves a rename once typing pauses, and shows it in the list", async () => {
    const user = userEvent.setup();
    open([search("a", "Product designer"), search("b", "Data analyst")]);
    await user.click(screen.getByRole("button", { name: "Edit Product designer" }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Designer");
    await waitFor(() => expect(updateAgentSearch).toHaveBeenCalled(), { timeout: 2000 });
    expect(updateAgentSearch).toHaveBeenLastCalledWith({ id: "a", changes: expect.objectContaining({ name: "Designer", keywords: "Product designer", country: "nl" }) });
    expect(updateAgentSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: "Run Designer" })).toBeInTheDocument();
    expect(updateAgentSearch).toHaveBeenLastCalledWith({ id: "a", changes: expect.not.objectContaining({ enabled: expect.anything() }) });
  });

  it("leaves a blank name out of the save", async () => {
    const user = userEvent.setup();
    open([search("a", "Product designer")]);
    await user.click(screen.getByRole("button", { name: "Edit Product designer" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Where"), "X");
    await waitFor(() => expect(updateAgentSearch).toHaveBeenCalled(), { timeout: 2000 });
    expect(vi.mocked(updateAgentSearch).mock.lastCall![0].changes).not.toHaveProperty("name");
  });

  it("pauses and resumes a search at once", async () => {
    const user = userEvent.setup();
    open([search("a", "Product designer")]);
    await user.click(screen.getByRole("switch", { name: "Run Product designer" }));
    expect(updateAgentSearch).toHaveBeenLastCalledWith({ id: "a", changes: { enabled: false } });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run Product designer" })).toHaveAttribute("aria-checked", "false"));
    await user.click(screen.getByRole("switch", { name: "Run Product designer" }));
    expect(updateAgentSearch).toHaveBeenLastCalledWith({ id: "a", changes: { enabled: true } });
  });

  it("switches back and says why when a search can't be turned on", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAgentSearch).mockResolvedValueOnce({ ok: false, error: "Add what to look for and a country before turning this search on." });
    open([search("a", "Product designer", { enabled: false })]);
    await user.click(screen.getByRole("switch", { name: "Run Product designer" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Add what to look for and a country before turning this search on."));
    expect(screen.getByRole("switch", { name: "Run Product designer" })).toHaveAttribute("aria-checked", "false");
  });

  it("asks before removing a search", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    open([search("a", "Product designer"), search("b", "Data analyst")], onChange);
    await user.click(screen.getByRole("button", { name: "Edit Product designer" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeAgentSearch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove search" }));
    expect(removeAgentSearch).toHaveBeenCalledWith({ id: "a" });
    await waitFor(() => expect(screen.queryByText(/^Product designer ·/)).not.toBeInTheDocument());
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "b" })]);
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
  });

  it("keeps a change made while another search's save is still under way", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    let finish: (value: Awaited<ReturnType<typeof updateAgentSearch>>) => void = () => {};
    vi.mocked(updateAgentSearch).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open([search("a", "Product designer"), search("b", "Data analyst")], onChange);
    await user.click(screen.getByRole("switch", { name: "Run Product designer" }));
    await user.click(screen.getByRole("switch", { name: "Run Data analyst" }));
    // Product designer's save fails and switches it back; Data analyst's pause stays.
    finish({ ok: false, error: "No." });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run Product designer" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Run Data analyst" })).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "a", enabled: true }), expect.objectContaining({ id: "b", enabled: false })]);
  });

  it("stops adding at 5", () => {
    open(Array.from({ length: 5 }, (_, index) => search(String(index), `Search ${index}`)));
    expect(screen.getByText("5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a search" })).toBeDisabled();
  });
});
