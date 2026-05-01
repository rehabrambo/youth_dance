const qrImage = document.querySelector("#qrImage");

loadAppInfo();

async function loadAppInfo() {
  const response = await fetch("/api/app-info");
  const info = await response.json();

  qrImage.src = `/qr.svg?data=${encodeURIComponent(info.submitUrl)}`;
}
