import { describe, expect, it } from "vitest";
import { readNote } from "@/lib/notebook-format";
import { createWorld } from "@/test/devices";

const member = "octo-member";
const notebook = "my-notes";

describe("tags and sync", () => {
  it("tags added and removed on the device reach the note's frontmatter in its notebook", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Plan");
    laptop.store.editBody(id, "Raised beds.\n");
    laptop.store.setTags(id, ["garden", "home"]);

    await laptop.sync();

    expect(readNote(world.github.files(member, notebook)["Plan.md"])).toMatchObject({ id, tags: ["garden", "home"] });
    expect(laptop.store.note(id)).toMatchObject({ tags: ["garden", "home"], synced: true });

    laptop.store.setTags(id, ["home"]);
    await laptop.sync();

    expect(readNote(world.github.files(member, notebook)["Plan.md"]).tags).toEqual(["home"]);
    expect(laptop.store.note(id)?.synced).toBe(true);
  });

  it("tags edited on github.com appear on the device after a pull, and reach the other device", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    const id = laptop.store.createNote();
    laptop.store.rename(id, "Plan");
    laptop.store.setTags(id, ["garden"]);
    await laptop.sync();
    const phone = await world.signIn(member);
    await phone.sync();
    expect(phone.store.note(id)?.tags).toEqual(["garden"]);

    world.github.commitFiles(member, notebook, {
      message: "Tag on github.com",
      files: { "Plan.md": `---\nid: ${id}\ntags: [garden, outdoors]\n---\n` },
    });
    await laptop.sync();
    await phone.sync();

    expect(laptop.store.note(id)).toMatchObject({ tags: ["garden", "outdoors"], synced: true });
    expect(phone.store.note(id)).toMatchObject({ tags: ["garden", "outdoors"], synced: true });
  });
});
