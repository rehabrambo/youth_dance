const featuredMessage = document.querySelector("#featuredMessage");
const visualizerCanvas = document.querySelector("#visualizerCanvas");
const visualizerContext = visualizerCanvas.getContext("2d");
const audioPrompt = document.querySelector("#audioPrompt");
const audioPromptTitle = document.querySelector("#audioPromptTitle");
const audioPromptDetail = document.querySelector("#audioPromptDetail");

let messages = [];
let activeIndex = 0;
let audioContext = null;
let analyser = null;
let frequencyData = null;
let waveformData = null;
let audioStarted = false;
let audioUnavailable = false;
let currentVisualizer = 0;
let visualizerWidth = 0;
let visualizerHeight = 0;
let visualizerScale = 1;

const events = new EventSource("/events/display");
events.addEventListener("snapshot", (event) => {
  messages = JSON.parse(event.data).approved || [];
  activeIndex = 0;
  renderDisplay();
});

setInterval(() => {
  if (messages.length > 1) {
    activeIndex = (activeIndex + 1) % Math.min(messages.length, 8);
    renderDisplay();
  }
}, 8000);

setupVisualizer();
setupAudioPrompt();

function renderDisplay() {
  featuredMessage.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-display";
    empty.textContent = "Waiting for approved messages";
    featuredMessage.append(empty);
    return;
  }

  const current = messages[activeIndex];
  const quote = document.createElement("p");
  quote.className = "featured-text";
  quote.textContent = current.text;

  const author = document.createElement("p");
  author.className = "featured-author";
  author.textContent = current.name;

  featuredMessage.append(quote, author);
}

function setupVisualizer() {
  resizeVisualizer();
  window.addEventListener("resize", resizeVisualizer);
  scheduleVisualizerSwitch();
  requestAnimationFrame(drawVisualizer);
}

function setupAudioPrompt() {
  audioPrompt.addEventListener("click", () => startAudioInput());

  if (!window.isSecureContext) {
    setAudioPrompt(
      "Audio blocked by Chrome",
      "Open http://localhost:3000/display on this screen to enable live audio.",
      "blocked",
    );
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setAudioPrompt("Audio not available", "This browser does not expose microphone input here.", "blocked");
  }
}

function resizeVisualizer() {
  const rect = visualizerCanvas.getBoundingClientRect();
  visualizerScale = Math.min(window.devicePixelRatio || 1, 2);
  visualizerWidth = Math.max(1, Math.floor(rect.width));
  visualizerHeight = Math.max(1, Math.floor(rect.height));
  visualizerCanvas.width = Math.floor(visualizerWidth * visualizerScale);
  visualizerCanvas.height = Math.floor(visualizerHeight * visualizerScale);
  visualizerContext.setTransform(visualizerScale, 0, 0, visualizerScale, 0, 0);
}

async function startAudioInput() {
  if (audioStarted) {
    if (audioContext?.state === "suspended") {
      await audioContext.resume();
    }
    return;
  }
  if (audioUnavailable) return;

  if (!window.isSecureContext) {
    setAudioPrompt(
      "Audio blocked by Chrome",
      "Open http://localhost:3000/display on this screen to enable live audio.",
      "blocked",
    );
    return;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !navigator.mediaDevices?.getUserMedia) {
    audioUnavailable = true;
    setAudioPrompt("Audio not available", "This browser does not expose microphone input here.", "blocked");
    return;
  }

  try {
    setAudioPrompt("Requesting audio", "Choose Allow when Chrome asks for microphone access.", "working");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.84;
    source.connect(analyser);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
    audioStarted = true;
    audioPrompt.hidden = true;
  } catch (error) {
    if (error.name === "NotAllowedError") {
      setAudioPrompt("Audio permission blocked", "Use Chrome's site settings to allow microphone access.", "blocked");
    } else if (error.name === "NotFoundError") {
      setAudioPrompt("No audio input found", "Connect or enable a microphone, mixer, or line-in device.", "blocked");
    } else {
      setAudioPrompt("Audio could not start", "Click to try again after checking Chrome permissions.", "blocked");
    }
  }
}

function setAudioPrompt(title, detail, state) {
  audioPrompt.hidden = false;
  audioPrompt.dataset.state = state;
  audioPromptTitle.textContent = title;
  audioPromptDetail.textContent = detail;
}

function scheduleVisualizerSwitch() {
  const delay = 12000 + Math.random() * 12000;
  setTimeout(() => {
    let next = currentVisualizer;
    while (next === currentVisualizer) {
      next = Math.floor(Math.random() * visualizerStyles.length);
    }
    currentVisualizer = next;
    scheduleVisualizerSwitch();
  }, delay);
}

function drawVisualizer(time) {
  const state = getAudioState(time);
  visualizerContext.clearRect(0, 0, visualizerWidth, visualizerHeight);
  visualizerStyles[currentVisualizer](state, time);
  requestAnimationFrame(drawVisualizer);
}

function getAudioState(time) {
  if (analyser && frequencyData && waveformData) {
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(waveformData);
    return {
      bass: averageRange(frequencyData, 0, 18) / 255,
      mid: averageRange(frequencyData, 18, 90) / 255,
      treble: averageRange(frequencyData, 90, frequencyData.length) / 255,
      level: averageRange(frequencyData, 0, frequencyData.length) / 255,
      frequency: frequencyData,
      waveform: waveformData,
    };
  }

  const pulse = time * 0.001;
  return {
    bass: 0.34 + Math.sin(pulse * 1.7) * 0.16,
    mid: 0.3 + Math.sin(pulse * 2.3 + 1.4) * 0.12,
    treble: 0.22 + Math.sin(pulse * 3.1 + 2.2) * 0.1,
    level: 0.28 + Math.sin(pulse * 1.3) * 0.12,
    frequency: null,
    waveform: null,
  };
}

function averageRange(values, start, end) {
  let total = 0;
  const safeEnd = Math.min(values.length, end);
  for (let index = start; index < safeEnd; index += 1) {
    total += values[index];
  }
  return total / Math.max(1, safeEnd - start);
}

const visualizerStyles = [
  drawPulseRings,
  drawSoftBars,
  drawWaveLines,
  drawDotMatrix,
  drawSignalBeams,
];

function drawPulseRings(state, time) {
  const centerX = visualizerWidth * 0.5;
  const centerY = visualizerHeight * 0.48;
  const maxRadius = Math.hypot(visualizerWidth, visualizerHeight) * 0.42;

  for (let index = 0; index < 8; index += 1) {
    const drift = (time * 0.00018 + index * 0.13) % 1;
    const radius = maxRadius * (0.18 + drift * 0.9) + state.bass * 30;
    const alpha = 0.2 - drift * 0.14;
    visualizerContext.beginPath();
    visualizerContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
    visualizerContext.lineWidth = 4 + state.mid * 8;
    visualizerContext.strokeStyle = `rgba(${index % 2 ? "0, 212, 255" : "255, 47, 125"}, ${alpha})`;
    visualizerContext.stroke();
  }
}

function drawSoftBars(state, time) {
  const bars = 46;
  const gap = 6;
  const barWidth = Math.max(6, visualizerWidth / bars - gap);
  const baseY = visualizerHeight;

  for (let index = 0; index < bars; index += 1) {
    const sample = state.frequency
      ? state.frequency[Math.floor((index / bars) * state.frequency.length)] / 255
      : 0.35 + Math.sin(time * 0.002 + index * 0.6) * 0.18;
    const height = Math.max(18, sample * visualizerHeight * 0.48);
    const x = index * (barWidth + gap);
    const hue = index % 3 === 0 ? "255, 47, 125" : index % 3 === 1 ? "0, 212, 255" : "198, 255, 0";
    visualizerContext.fillStyle = `rgba(${hue}, ${0.16 + sample * 0.18})`;
    visualizerContext.fillRect(x, baseY - height, barWidth, height);
  }
}

function drawWaveLines(state, time) {
  const lines = 4;

  for (let line = 0; line < lines; line += 1) {
    visualizerContext.beginPath();
    for (let index = 0; index <= 120; index += 1) {
      const x = (index / 120) * visualizerWidth;
      const waveIndex = state.waveform ? Math.floor((index / 120) * state.waveform.length) : 0;
      const audioOffset = state.waveform ? (state.waveform[waveIndex] - 128) / 128 : Math.sin(time * 0.003 + index * 0.12);
      const y =
        visualizerHeight * (0.26 + line * 0.16) +
        audioOffset * (34 + state.level * 90) +
        Math.sin(time * 0.0014 + index * 0.08 + line) * 16;

      if (index === 0) {
        visualizerContext.moveTo(x, y);
      } else {
        visualizerContext.lineTo(x, y);
      }
    }
    visualizerContext.lineWidth = 3 + state.treble * 5;
    visualizerContext.strokeStyle = line % 2 === 0 ? "rgba(0, 212, 255, 0.28)" : "rgba(255, 47, 125, 0.24)";
    visualizerContext.stroke();
  }
}

function drawDotMatrix(state, time) {
  const spacing = 34;
  for (let y = spacing; y < visualizerHeight; y += spacing) {
    for (let x = spacing; x < visualizerWidth; x += spacing) {
      const ripple = Math.sin(time * 0.003 + x * 0.02 + y * 0.015);
      const radius = 2 + Math.max(0, ripple) * 3 + state.level * 8;
      const alpha = 0.1 + Math.max(0, ripple) * 0.12 + state.level * 0.12;
      visualizerContext.beginPath();
      visualizerContext.arc(x, y, radius, 0, Math.PI * 2);
      visualizerContext.fillStyle = `rgba(198, 255, 0, ${alpha})`;
      visualizerContext.fill();
    }
  }
}

function drawSignalBeams(state, time) {
  const beamCount = 9;
  visualizerContext.save();
  visualizerContext.translate(visualizerWidth * 0.5, visualizerHeight * 0.52);
  visualizerContext.rotate(Math.sin(time * 0.0004) * 0.18);

  for (let index = 0; index < beamCount; index += 1) {
    const angle = (Math.PI * 2 * index) / beamCount + time * 0.00012;
    const length = visualizerWidth * (0.42 + state.bass * 0.18);
    const width = 18 + state.mid * 34;
    visualizerContext.rotate(angle);
    visualizerContext.fillStyle = index % 2 === 0 ? "rgba(255, 47, 125, 0.12)" : "rgba(0, 212, 255, 0.12)";
    visualizerContext.fillRect(0, -width / 2, length, width);
    visualizerContext.rotate(-angle);
  }

  visualizerContext.restore();
}
