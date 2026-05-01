const pendingList = document.querySelector("#pendingList");
const approvedList = document.querySelector("#approvedList");
const rejectedList = document.querySelector("#rejectedList");
const pendingCount = document.querySelector("#pendingCount");
const approvedCount = document.querySelector("#approvedCount");
const rejectedCount = document.querySelector("#rejectedCount");

const params = new URLSearchParams(window.location.search);
const keyFromUrl = params.get("key");
if (keyFromUrl) {
  localStorage.setItem("moderatorKey", keyFromUrl);
}
const moderatorKey = keyFromUrl || localStorage.getItem("moderatorKey") || "";

connectEvents();

function connectEvents() {
  const eventUrl = moderatorKey
    ? `/events/moderator?key=${encodeURIComponent(moderatorKey)}`
    : "/events/moderator";
  const events = new EventSource(eventUrl);

  events.addEventListener("snapshot", (event) => {
    renderState(JSON.parse(event.data));
  });

  events.onerror = () => {
    renderState({
      pending: [],
      approved: [],
      rejected: [],
      counts: { pending: 0, approved: 0, rejected: 0 },
      error: "Connection lost.",
    });
  };
}

function renderState(state) {
  pendingCount.textContent = state.counts?.pending ?? state.pending.length;
  approvedCount.textContent = state.counts?.approved ?? state.approved.length;
  rejectedCount.textContent = state.counts?.rejected ?? state.rejected.length;

  renderList(pendingList, state.pending, "No pending messages", [
    { label: "Approve", status: "approved", tone: "approve" },
    { label: "Reject", status: "rejected", tone: "reject" },
  ]);

  renderList(approvedList, state.approved, "No approved messages", [
    { label: "Hide", status: "rejected", tone: "reject" },
    { label: "Queue", status: "pending", tone: "neutral" },
  ]);

  renderList(rejectedList, state.rejected, "No rejected messages", [
    { label: "Queue", status: "pending", tone: "neutral" },
    { label: "Approve", status: "approved", tone: "approve" },
    { label: "Delete", delete: true, tone: "delete" },
  ]);
}

function renderList(container, messages, emptyText, actions) {
  container.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  for (const message of messages) {
    const article = document.createElement("article");
    article.className = "moderation-card";

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("strong");
    name.textContent = message.name;
    const time = document.createElement("span");
    time.textContent = formatTime(message.createdAt);
    meta.append(name, time);

    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = message.text;

    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `small-button ${action.tone}`;
      button.textContent = action.label;
      button.addEventListener("click", () => {
        if (action.delete) {
          deleteMessage(message.id);
        } else {
          updateStatus(message.id, action.status);
        }
      });
      actionRow.append(button);
    }

    article.append(meta, text, actionRow);
    container.append(article);
  }
}

async function updateStatus(id, status) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(moderatorKey ? { "X-Moderator-Key": moderatorKey } : {}),
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    alert(result.error || "Could not update message.");
  }
}

async function deleteMessage(id) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      ...(moderatorKey ? { "X-Moderator-Key": moderatorKey } : {}),
    },
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    alert(result.error || "Could not delete message.");
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
