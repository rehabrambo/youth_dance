const form = document.querySelector("#messageForm");
const nameInput = document.querySelector("#nameInput");
const messageInput = document.querySelector("#messageInput");
const characterCount = document.querySelector("#characterCount");
const formStatus = document.querySelector("#formStatus");

let maxMessageLength = 240;

fetch("/api/app-info")
  .then((response) => response.json())
  .then((info) => {
    maxMessageLength = info.maxMessageLength || maxMessageLength;
    messageInput.maxLength = maxMessageLength;
    updateCount();
  })
  .catch(() => updateCount());

messageInput.addEventListener("input", updateCount);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("", "");

  const text = messageInput.value.trim();
  if (!text) {
    setStatus("Write a message before sending.", "error");
    return;
  }

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Sending";

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value,
        text,
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Message could not be sent.");

    messageInput.value = "";
    updateCount();
    setStatus("Sent for moderation.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send";
  }
});

function updateCount() {
  characterCount.textContent = `${messageInput.value.length} / ${maxMessageLength}`;
}

function setStatus(message, tone) {
  formStatus.textContent = message;
  formStatus.dataset.tone = tone;
}
