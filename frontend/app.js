const presets = {
    "samarkand-drive": ["dom", "bak", "rak", "rest", "dom", "rak", "bak", "rest", "dom", "bak", "rak", "dom"],
    "ceremonial-loop": ["dom", "rest", "dom", "bak", "rak", "bak", "dom", "rak", "rest", "dom", "bak", "rak"],
    "night-caravan": ["rak", "bak", "dom", "rest", "rak", "dom", "bak", "rak", "dom", "rest", "bak", "rak"],
    "machine-zarb": ["dom", "dom", "rak", "bak", "rest", "rak", "dom", "bak", "dom", "rak", "bak", "rest"]
};

const strokeColors = {
    dom: "#f3b15a",
    bak: "#6ae1ce",
    rak: "#f27c9b",
    rest: "#7e9188"
};

const elements = {
    playButton: document.getElementById("playButton"),
    stopButton: document.getElementById("stopButton"),
    presetSelect: document.getElementById("presetSelect"),
    bpmSlider: document.getElementById("bpmSlider"),
    bpmValue: document.getElementById("bpmValue"),
    sequenceInput: document.getElementById("sequenceInput"),
    sequenceGrid: document.getElementById("sequenceGrid"),
    sequenceLength: document.getElementById("sequenceLength"),
    currentStroke: document.getElementById("currentStroke"),
    stage: document.getElementById("stage"),
    robotRig: document.getElementById("robotRig"),
    robotParts: {
        headUnit: document.getElementById("headUnit"),
        torsoCore: document.getElementById("torsoCore"),
        strikingUpperArm: document.getElementById("strikingUpperArm"),
        strikingForearm: document.getElementById("strikingForearm"),
        strikingHand: document.getElementById("strikingHand"),
        supportUpperArm: document.getElementById("supportUpperArm"),
        supportForearm: document.getElementById("supportForearm"),
        supportHand: document.getElementById("supportHand"),
        doyraGroup: document.getElementById("doyraGroup")
    },
    strokePills: Array.from(document.querySelectorAll(".stroke-pill"))
};

const state = {
    isPlaying: false,
    audioContext: null,
    noiseBuffer: null,
    activeTimeout: null
};

function ensureAudioContext() {
    if (!state.audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContextClass();
        state.noiseBuffer = createNoiseBuffer(state.audioContext);
    }

    if (state.audioContext.state === "suspended") {
        state.audioContext.resume();
    }
}

function createNoiseBuffer(context) {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
    }

    return buffer;
}

function parseSequence(raw) {
    return raw
        .split(/[\s,]+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean)
        .filter((token) => ["dom", "bak", "rak", "rest"].includes(token));
}

function renderSequence(sequence) {
    elements.sequenceGrid.innerHTML = "";
    sequence.forEach((stroke, index) => {
        const step = document.createElement("div");
        step.className = `sequence-step stroke-${stroke}`;
        step.dataset.index = String(index);
        step.textContent = stroke;
        elements.sequenceGrid.appendChild(step);
    });
    elements.sequenceLength.textContent = String(sequence.length);
}

function setPreset(presetKey) {
    const sequence = presets[presetKey] || presets["samarkand-drive"];
    elements.sequenceInput.value = sequence.join(" ");
    renderSequence(sequence);
}

function updateBpmLabel() {
    elements.bpmValue.textContent = elements.bpmSlider.value;
}

function updateActiveStep(index) {
    const steps = Array.from(elements.sequenceGrid.children);
    steps.forEach((step) => step.classList.remove("is-active"));
    const current = steps[index];
    if (current) {
        current.classList.add("is-active");
    }
}

function animateStroke(stroke) {
    elements.currentStroke.textContent = stroke.toUpperCase();
    elements.stage.dataset.stroke = stroke;
    document.documentElement.style.setProperty("--pulse-color", strokeColors[stroke] || "#ffffff");

    elements.stage.classList.remove("is-hit");
    void elements.stage.offsetWidth;
    elements.stage.classList.add("is-hit");

    if (state.activeTimeout) {
        window.clearTimeout(state.activeTimeout);
    }

    state.activeTimeout = window.setTimeout(() => {
        elements.stage.classList.remove("is-hit");
    }, 280);
}

function playDom(context, startTime) {
    const oscillator = context.createOscillator();
    const subOscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    subOscillator.type = "sine";
    oscillator.frequency.setValueAtTime(120, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(58, startTime + 0.18);
    subOscillator.frequency.setValueAtTime(62, startTime);
    subOscillator.frequency.exponentialRampToValueAtTime(42, startTime + 0.19);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.7, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22);

    oscillator.connect(gain);
    subOscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(startTime);
    subOscillator.start(startTime);
    oscillator.stop(startTime + 0.24);
    subOscillator.stop(startTime + 0.24);
}

function playBak(context, startTime) {
    const source = context.createBufferSource();
    source.buffer = state.noiseBuffer;

    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1700, startTime);
    bandpass.Q.value = 1.6;

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(900, startTime);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.54, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);

    source.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(gain);
    gain.connect(context.destination);

    source.start(startTime);
    source.stop(startTime + 0.14);
}

function playRak(context, startTime) {
    const oscillator = context.createOscillator();
    const source = context.createBufferSource();
    source.buffer = state.noiseBuffer;

    const oscillatorGain = context.createGain();
    const noiseGain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(960, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(460, startTime + 0.08);

    oscillatorGain.gain.setValueAtTime(0.0001, startTime);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.23, startTime + 0.003);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.09);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2600, startTime);
    filter.Q.value = 3.4;

    noiseGain.gain.setValueAtTime(0.0001, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.15, startTime + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.06);

    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(context.destination);

    source.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(context.destination);

    oscillator.start(startTime);
    source.start(startTime);
    oscillator.stop(startTime + 0.1);
    source.stop(startTime + 0.08);
}

function triggerStroke(stroke) {
    if (stroke === "rest") {
        return;
    }

    ensureAudioContext();
    const context = state.audioContext;
    const startTime = context.currentTime + 0.01;

    if (stroke === "dom") {
        playDom(context, startTime);
        return;
    }

    if (stroke === "bak") {
        playBak(context, startTime);
        return;
    }

    if (stroke === "rak") {
        playRak(context, startTime);
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function playSequence() {
    const sequence = parseSequence(elements.sequenceInput.value);
    if (!sequence.length || state.isPlaying) {
        return;
    }

    ensureAudioContext();
    state.isPlaying = true;
    elements.stage.classList.add("is-playing");
    elements.currentStroke.textContent = "Starting";
    renderSequence(sequence);

    const bpm = Number(elements.bpmSlider.value);
    const stepMs = 60000 / bpm;

    for (let index = 0; index < sequence.length; index += 1) {
        if (!state.isPlaying) {
            break;
        }

        const stroke = sequence[index];
        updateActiveStep(index);
        animateStroke(stroke);
        triggerStroke(stroke);
        await sleep(stepMs);
    }

    stopSequence();
}

function stopSequence() {
    state.isPlaying = false;
    elements.stage.classList.remove("is-playing", "is-hit");
    elements.stage.dataset.stroke = "rest";
    elements.currentStroke.textContent = "Idle";
    Array.from(elements.sequenceGrid.children).forEach((step) => step.classList.remove("is-active"));
}

elements.playButton.addEventListener("click", playSequence);
elements.stopButton.addEventListener("click", stopSequence);

elements.presetSelect.addEventListener("change", (event) => {
    setPreset(event.target.value);
});

elements.bpmSlider.addEventListener("input", updateBpmLabel);

elements.sequenceInput.addEventListener("input", () => {
    renderSequence(parseSequence(elements.sequenceInput.value));
});

elements.strokePills.forEach((pill) => {
    pill.addEventListener("click", () => {
        const current = elements.sequenceInput.value.trim();
        elements.sequenceInput.value = current ? `${current} ${pill.dataset.token}` : pill.dataset.token;
        renderSequence(parseSequence(elements.sequenceInput.value));
    });
});

document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
        event.preventDefault();
        if (state.isPlaying) {
            stopSequence();
        } else {
            playSequence();
        }
    }
});

updateBpmLabel();
elements.stage.dataset.stroke = "rest";
setPreset(elements.presetSelect.value);
