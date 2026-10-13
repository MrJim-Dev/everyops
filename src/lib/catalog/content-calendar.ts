import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, todayKey } from "@/lib/time";
import { f, recordFactory } from "./define";

export function contentBlueprint(workspaceName = "Content calendar"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      {
        id: "content",
        name: "Content",
        icon: "megaphone",
        viewIds: ["board", "content_calendar", "content_list"],
        widgetIds: [],
      },
      {
        id: "overview",
        name: "Overview",
        icon: "gauge",
        viewIds: [],
        widgetIds: ["in_review", "scheduled", "posted_month", "review_list"],
      },
    ],
    entities: [
      {
        id: "post",
        name: "Post",
        pluralName: "Posts",
        primaryFieldId: "title",
        fields: [
          f.text("title", "Title", { required: true }),
          f.longText("caption", "Caption"),
          f.select(
            "channel",
            "Channel",
            [
              ["instagram", "Instagram"],
              ["facebook", "Facebook"],
              ["tiktok", "TikTok"],
            ],
            { required: true },
          ),
          f.select("pillar", "Pillar", [
            ["product", "Product"],
            ["people", "People"],
            ["community", "Community"],
            ["education", "Education"],
            ["promo", "Promo"],
          ]),
          f.status(
            "status",
            "Stage",
            [
              ["idea", "Ideas"],
              ["draft", "Drafts"],
              ["review", "In review", "warning"],
              ["scheduled", "Scheduled", "accent"],
              ["posted", "Published", "success"],
            ],
            { required: true },
          ),
          f.person("owner", "Owner"),
          f.date("publish_on", "Publish on"),
        ],
      },
    ],
    views: [
      {
        id: "board",
        entityId: "post",
        name: "Board",
        type: "kanban",
        statusFieldId: "status",
        cardFieldIds: ["channel", "owner", "publish_on"],
        filter: "status != 'posted'",
      },
      {
        id: "content_calendar",
        entityId: "post",
        name: "Calendar",
        type: "calendar",
        dateFieldId: "publish_on",
        titleFieldId: "title",
      },
      {
        id: "content_list",
        entityId: "post",
        name: "List",
        type: "table",
        fieldIds: ["title", "channel", "pillar", "status", "owner", "publish_on"],
        sort: [{ fieldId: "publish_on", dir: "asc" }],
      },
    ],
    widgets: [
      {
        id: "in_review",
        title: "In review",
        entityId: "post",
        type: "stat",
        filter: "status == 'review'",
        metric: { op: "count" },
      },
      {
        id: "scheduled",
        title: "Scheduled",
        entityId: "post",
        type: "stat",
        filter: "status == 'scheduled'",
        metric: { op: "count" },
      },
      {
        id: "posted_month",
        title: "Published this month",
        entityId: "post",
        type: "stat",
        filter: "status == 'posted' && is_this_month(publish_on)",
        metric: { op: "count" },
      },
      {
        id: "review_list",
        title: "Waiting for review",
        entityId: "post",
        type: "list",
        filter: "status == 'review'",
        metric: { op: "count" },
        list: { fieldIds: ["channel", "publish_on"], limit: 5, viewId: "board" },
      },
    ],
    rules: [
      {
        id: "review_notice",
        name: "Tell the reviewer",
        trigger: { entityId: "post", event: "status_changed", fieldId: "status", to: "review" },
        actions: [{ type: "notify", message: "Mila was asked to review “{{title}}”." }],
      },
    ],
  };
}

export function contentSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = contentBlueprint(workspaceName);
  const rec = recordFactory(now);
  const today = todayKey(now);
  const posts: [string, string, string, string, string, number, string][] = [
    [
      "Ube latte launch",
      "instagram",
      "product",
      "idea",
      "Kim Pascual",
      1,
      "Showcase the new ube latte and its colour.",
    ],
    [
      "Customer mug stories",
      "facebook",
      "community",
      "idea",
      "Mila Torres",
      3,
      "Regulars and the mugs they always pick.",
    ],
    [
      "Weekend coffee ritual",
      "instagram",
      "community",
      "idea",
      "Dan Lao",
      5,
      "How our community spends Saturday mornings.",
    ],
    [
      "Meet our barista Jun",
      "facebook",
      "people",
      "draft",
      "James Ocampo",
      2,
      "A day in the life at Kapé Ilaya.",
    ],
    [
      "How we roast",
      "instagram",
      "education",
      "draft",
      "Ana Cruz",
      4,
      "Behind the scenes of our roasting process.",
    ],
    [
      "Cebu bean sourcing story",
      "facebook",
      "product",
      "review",
      "Mila Torres",
      0,
      "From farm to cup: our partnership with Cebu farmers.",
    ],
    [
      "Rainy-day playlist reel",
      "instagram",
      "community",
      "review",
      "Kim Pascual",
      0,
      "Coffee and music for brighter days.",
    ],
    [
      "Weekend 2-for-1",
      "instagram",
      "promo",
      "scheduled",
      "Ana Cruz",
      4,
      "Celebrate the weekend with something special.",
    ],
    [
      "New pastries this week",
      "facebook",
      "product",
      "scheduled",
      "James Ocampo",
      5,
      "Fresh bakes, perfect with your coffee.",
    ],
    [
      "Brewing tips: French press",
      "instagram",
      "education",
      "scheduled",
      "Dan Lao",
      6,
      "Simple tips for a better cup at home.",
    ],
    ["Soft opening highlights", "instagram", "community", "posted", "James Ocampo", -9, ""],
    ["What's in an ube latte?", "instagram", "product", "posted", "Dan Lao", -6, ""],
    ["Behind the bar", "tiktok", "people", "posted", "Mila Torres", -4, ""],
    ["Thank you, Makati!", "facebook", "community", "posted", "James Ocampo", -2, ""],
  ];
  const records: DataRecord[] = posts.map(([title, channel, pillar, status, owner, offset, caption], i) =>
    rec("post", `post_${i + 1}`, {
      title,
      channel,
      pillar,
      status,
      owner,
      publish_on: addDays(today, offset),
      caption,
    }),
  );
  return { blueprint, records: computeAll(blueprint, records, now) };
}
