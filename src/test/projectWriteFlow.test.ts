// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildCreateProjectCommand,
  buildCreateUpdateCommand,
  buildDeleteUpdateCommand,
  buildEditUpdateCommand,
} from "@/lib/projectWriteFlow";

const PROJECT_KEY = "project-create:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPDATE_KEY = "update-create:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EDIT_KEY = "update-edit:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELETE_KEY = "update-delete:dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("project write commands", () => {
  it("maps a new-project draft to the strict API contract without actor or path fields", () => {
    const command = buildCreateProjectCommand({
      title: "  Ons huis  ",
      description: "  Van boven tot onder  ",
      projectType: "Volledige renovatie",
      address: "  Hoofdstraat 12  ",
      startDate: "2026-08-04",
      expectedEndDate: "2027-02-14",
      visibility: "public",
    }, PROJECT_KEY);

    expect(command).toEqual({
      visibility: "public",
      input: {
        idempotencyKey: PROJECT_KEY,
        title: "Ons huis",
        description: "Van boven tot onder",
        projectType: "Volledige renovatie",
        startDate: "2026-08-04",
        expectedEndDate: "2027-02-14",
        privateDetails: { addressLine1: "Hoofdstraat 12" },
      },
    });
    expect(command.input).not.toHaveProperty("userId");
    expect(command.input).not.toHaveProperty("user_id");
    expect(command.input).not.toHaveProperty("ownerId");
    expect(command.input).not.toHaveProperty("visibility");
  });

  it("maps ready asset IDs, phase UUID and order into one published update command", () => {
    const phaseId = "11111111-1111-4111-8111-111111111111";
    const firstAssetId = "22222222-2222-4222-8222-222222222222";
    const secondAssetId = "33333333-3333-4333-8333-333333333333";

    const command = buildCreateUpdateCommand({
      title: "  De muur is open  ",
      description: "  Leidingen gevonden  ",
      updateDate: "2026-08-04",
      phaseId,
      isMilestone: true,
      media: [
        { assetId: firstAssetId, compareRole: "before" },
        { assetId: secondAssetId, compareRole: null },
      ],
    }, { version: 7 }, UPDATE_KEY);

    expect(command).toEqual({
      idempotencyKey: UPDATE_KEY,
      expectedProjectVersion: 7,
      updateDate: "2026-08-04",
      title: "De muur is open",
      description: "Leidingen gevonden",
      phaseId,
      isMilestone: true,
      media: [
        { assetId: firstAssetId, role: "before", sortOrder: 0 },
        { assetId: secondAssetId, role: "gallery", sortOrder: 1 },
      ],
      publish: true,
    });
    expect(command).not.toHaveProperty("userId");
    expect(command).not.toHaveProperty("storagePath");
    expect(command).not.toHaveProperty("contractor");
    expect(command).not.toHaveProperty("budget");
  });

  it("builds one full replacement manifest for an optimistic update edit", () => {
    const firstAssetId = "22222222-2222-4222-8222-222222222222";
    const secondAssetId = "33333333-3333-4333-8333-333333333333";
    const command = buildEditUpdateCommand({
      title: "  Nieuwe titel  ",
      room: "  Keuken  ",
      description: "   ",
      updateDate: "2026-08-05",
      phaseId: "",
      isMilestone: false,
      media: [
        { assetId: secondAssetId, compareRole: "after", caption: " Na " },
        { assetId: firstAssetId, compareRole: "before", caption: null },
      ],
    }, 9, EDIT_KEY);

    expect(command).toEqual({
      idempotencyKey: EDIT_KEY,
      expectedVersion: 9,
      updateDate: "2026-08-05",
      title: "Nieuwe titel",
      room: "Keuken",
      description: null,
      phaseId: null,
      isMilestone: false,
      media: [
        { assetId: secondAssetId, role: "after", sortOrder: 0, caption: "Na" },
        { assetId: firstAssetId, role: "before", sortOrder: 1 },
      ],
    });
  });

  it("requires the destructive confirmation in a version-bound delete command", () => {
    expect(buildDeleteUpdateCommand(9, DELETE_KEY)).toEqual({
      idempotencyKey: DELETE_KEY,
      expectedVersion: 9,
      confirmation: "delete-update",
    });
  });
});
