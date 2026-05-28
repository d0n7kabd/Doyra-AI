const sampleFiles = [
    { id: "dom", label: "dom", file: "dom.wav" },
    { id: "bak", label: "bak", file: "bak.wav" },
    { id: "dom bak bak dom bak", label: "dom bak bak dom bak", file: "Dom Bak Bak Dom Bak.wav" },
    { id: "arabic", label: "arabic", file: "Arabic.wav" }
];

const strokeColors = {
    dom: "#f3b15a",
    bak: "#6ae1ce",
    arabic: "#f27c9b",
    phrase: "#9ee7d8",
    rest: "#7e9188"
};

const elements = {
    playButton: document.getElementById("playButton"),
    stopButton: document.getElementById("stopButton"),
    sequenceInput: document.getElementById("sequenceInput"),
    sequenceGrid: document.getElementById("sequenceGrid"),
    sequenceLength: document.getElementById("sequenceLength"),
    currentStroke: document.getElementById("currentStroke"),
    stage: document.getElementById("stage"),
    sampleButtons: document.getElementById("sampleButtons")
};

const state = {
    isPlaying: false,
    audioContext: null,
    samples: new Map(),
    activeSource: null,
    timers: []
};

function ensureAudioContext() {
    if (!state.audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContextClass();
    }

    if (state.audioContext.state === "suspended") {
        return state.audioContext.resume();
    }

    return Promise.resolve();
}

function sampleUrl(file) {
    return `../samples/${encodeURIComponent(file).replaceAll("%20", " ")}`;
}

async function loadSample(sample) {
    const response = await fetch(sampleUrl(sample.file));
    if (!response.ok) {
        throw new Error(`Could not load ${sample.file}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
    const onsets = detectOnsets(audioBuffer);
    return { ...sample, audioBuffer, onsets };
}

async function loadSamples() {
    await ensureAudioContext();
    const loadedSamples = await Promise.all(sampleFiles.map(loadSample));
    loadedSamples.forEach((sample) => state.samples.set(sample.id, sample));
}

function detectOnsets(audioBuffer) {
    const channel = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const frameSize = Math.max(512, Math.round(sampleRate * 0.012));
    const energies = [];

    for (let offset = 0; offset < channel.length; offset += frameSize) {
        let sum = 0;
        for (let index = offset; index < Math.min(offset + frameSize, channel.length); index += 1) {
            sum += channel[index] * channel[index];
        }
        energies.push(Math.sqrt(sum / frameSize));
    }

    const peak = Math.max(...energies, 0.001);
    const onsets = [];
    let lastOnsetTime = -0.12;

    for (let index = 1; index < energies.length; index += 1) {
        const previous = energies[index - 1];
        const current = energies[index];
        const time = (index * frameSize) / sampleRate;
        const isPeak = current > peak * 0.24 && current > previous * 1.55;

        if (isPeak && time - lastOnsetTime >= 0.11) {
            onsets.push(time);
            lastOnsetTime = time;
        }
    }

    if (!onsets.length || onsets[0] > 0.08) {
        onsets.unshift(0);
    }

    return onsets.slice(0, 32);
}

function parseSequence(raw) {
    const normalized = raw.toLowerCase().replaceAll("\n", " ").trim();
    if (!normalized) {
        return [];
    }

    const tokens = [];
    let cursor = 0;
    const idsByLength = sampleFiles.map((sample) => sample.id).sort((a, b) => b.length - a.length);

    while (cursor < normalized.length) {
        while (normalized[cursor] === " " || normalized[cursor] === ",") {
            cursor += 1;
        }

        const remaining = normalized.slice(cursor);
        const matchedId = idsByLength.find((id) => {
            if (!remaining.startsWith(id)) {
                return false;
            }
            const nextChar = remaining[id.length];
            return !nextChar || nextChar === " " || nextChar === ",";
        });

        if (matchedId) {
            tokens.push(matchedId);
            cursor += matchedId.length;
            continue;
        }

        const nextBreak = remaining.search(/[\s,]/);
        cursor += nextBreak === -1 ? remaining.length : nextBreak + 1;
    }

    return tokens;
}

function renderSequence(sequence) {
    elements.sequenceGrid.innerHTML = "";

    sequence.forEach((id, index) => {
        const sample = state.samples.get(id) || sampleFiles.find((item) => item.id === id);
        const step = document.createElement("div");
        step.className = `sequence-step stroke-${id.replaceAll(" ", "-")}`;
        step.dataset.index = String(index);
        step.textContent = sample?.label || id;
        elements.sequenceGrid.appendChild(step);
    });

    elements.sequenceLength.textContent = String(sequence.length);
}

function updateActiveStep(index) {
    Array.from(elements.sequenceGrid.children).forEach((step) => step.classList.remove("is-active"));
    const current = elements.sequenceGrid.children[index];
    if (current) {
        current.classList.add("is-active");
    }
}

function strokeKind(label) {
    if (label === "dom" || label.includes("dom")) {
        return "dom";
    }
    if (label === "bak" || label.includes("bak")) {
        return "bak";
    }
    if (label.includes("arabic")) {
        return "arabic";
    }
    return "phrase";
}

function animateStroke(label) {
    const kind = strokeKind(label);
    elements.currentStroke.textContent = label.toUpperCase();
    elements.stage.dataset.stroke = kind;
    document.documentElement.style.setProperty("--pulse-color", strokeColors[kind] || strokeColors.phrase);

    elements.stage.classList.remove("is-hit");
    void elements.stage.offsetWidth;
    elements.stage.classList.add("is-hit");

    const timer = window.setTimeout(() => {
        elements.stage.classList.remove("is-hit");
    }, 170);
    state.timers.push(timer);
}

function clearTimers() {
    state.timers.forEach((timer) => window.clearTimeout(timer));
    state.timers = [];
}

function scheduleOnsetAnimations(sample) {
    const phraseParts = sample.id.split(" ");
    sample.onsets.forEach((onset, index) => {
        const label = phraseParts.length > 1 ? phraseParts[index % phraseParts.length] : sample.label;
        const timer = window.setTimeout(() => animateStroke(label), Math.max(0, onset * 1000));
        state.timers.push(timer);
    });
}

function playSample(sample) {
    return new Promise((resolve) => {
        const source = state.audioContext.createBufferSource();
        source.buffer = sample.audioBuffer;
        source.connect(state.audioContext.destination);
        state.activeSource = source;

        scheduleOnsetAnimations(sample);
        source.onended = () => {
            state.activeSource = null;
            resolve();
        };
        source.start();
    });
}

async function playSequence() {
    if (state.isPlaying) {
        return;
    }

    try {
        if (!state.samples.size) {
            elements.currentStroke.textContent = "Loading";
            await loadSamples();
        } else {
            await ensureAudioContext();
        }
    } catch (error) {
        elements.currentStroke.textContent = "Load failed";
        console.error(error);
        return;
    }

    const sequence = parseSequence(elements.sequenceInput.value);
    if (!sequence.length) {
        elements.currentStroke.textContent = "No samples";
        return;
    }

    state.isPlaying = true;
    elements.stage.classList.add("is-playing");
    renderSequence(sequence);

    for (let index = 0; index < sequence.length; index += 1) {
        if (!state.isPlaying) {
            break;
        }

        const sample = state.samples.get(sequence[index]);
        if (!sample) {
            continue;
        }

        updateActiveStep(index);
        await playSample(sample);
    }

    stopSequence();
}

function stopSequence() {
    state.isPlaying = false;
    clearTimers();

    if (state.activeSource) {
        try {
            state.activeSource.stop();
        } catch {
            // Source may already have ended.
        }
        state.activeSource = null;
    }

    elements.stage.classList.remove("is-playing", "is-hit");
    elements.stage.dataset.stroke = "rest";
    elements.currentStroke.textContent = "Idle";
    Array.from(elements.sequenceGrid.children).forEach((step) => step.classList.remove("is-active"));
}

function appendToken(token) {
    const current = elements.sequenceInput.value.trim();
    elements.sequenceInput.value = current ? `${current} ${token}` : token;
    renderSequence(parseSequence(elements.sequenceInput.value));
}

function renderSampleButtons() {
    elements.sampleButtons.innerHTML = "";
    sampleFiles.forEach((sample) => {
        const button = document.createElement("button");
        button.className = "stroke-pill";
        button.type = "button";
        button.textContent = sample.label.toUpperCase();
        button.addEventListener("click", () => appendToken(sample.id));
        elements.sampleButtons.appendChild(button);
    });
}

elements.playButton.addEventListener("click", playSequence);
elements.stopButton.addEventListener("click", stopSequence);
elements.sequenceInput.addEventListener("input", () => renderSequence(parseSequence(elements.sequenceInput.value)));

document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.target !== elements.sequenceInput) {
        event.preventDefault();
        if (state.isPlaying) {
            stopSequence();
        } else {
            playSequence();
        }
    }
});

elements.stage.dataset.stroke = "rest";
elements.sequenceInput.value = "dom bak bak dom bak arabic";
renderSampleButtons();
renderSequence(parseSequence(elements.sequenceInput.value));
