const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const timerDisplay = document.getElementById('timer');
const flashElement = document.getElementById('flash');

// Audio Engine
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(freq, type, duration) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}
const sounds = {
    tick: () => playSound(880, 'sine', 0.1),
    snap: () => playSound(220, 'square', 0.4),
    lock: () => playSound(440, 'triangle', 0.2),
    reset: () => playSound(110, 'sawtooth', 0.3)
};

// Game State
let pieces = [], grabbedPiece = null, isCaptured = false, isCountingDown = false;
let countdownValue = 3, countdownTimer = null, startTime, timerInterval, resetCounter = 0;
const rows = 3, cols = 3;

const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

function isFist(landmarks) {
    const fingerTips = [8, 12, 16, 20], fingerPips = [6, 10, 14, 18];
    let closed = 0;
    for (let i = 0; i < 4; i++) if (landmarks[fingerTips[i]].y > landmarks[fingerPips[i]].y) closed++;
    return closed >= 3;
}

function startCountdown(rect) {
    isCountingDown = true; countdownValue = 3; sounds.tick();
    countdownTimer = setInterval(() => {
        countdownValue--;
        if (countdownValue > 0) sounds.tick();
        if (countdownValue <= 0) {
            clearInterval(countdownTimer); isCountingDown = false;
            flashElement.style.opacity = '1'; setTimeout(() => flashElement.style.opacity = '0', 150);
            sounds.snap(); snapPhotoDynamic(rect);
        }
    }, 1000);
}

function snapPhotoDynamic(rect) {
    isCaptured = true;
    const pW = rect.w / cols, pH = rect.h / rows;
    pieces = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = pW; tempCanvas.height = pH;
            const sourceX = (videoElement.videoWidth - (rect.x + rect.w)) + (c * pW);
            tempCanvas.getContext('2d').drawImage(videoElement, sourceX, rect.y + (r * pH), pW, pH, 0, 0, pW, pH);
            pieces.push({
                img: tempCanvas, x: Math.random() * (canvasElement.width - pW), y: Math.random() * (canvasElement.height - pH),
                targetX: rect.x + (c * pW), targetY: rect.y + (r * pH), w: pW, h: pH, isLocked: false
            });
        }
    }
    startTime = Date.now();
    timerInterval = setInterval(() => {
        timerDisplay.innerText = `TIME: ${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    }, 100);
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks) {
        let allX = [], allY = [], pinches = 0, fist = false;
        for (const landmarks of results.multiHandLandmarks) {
            if (isFist(landmarks)) fist = true;
            if (getDist(landmarks[4], landmarks[8]) < 0.06) pinches++;
            landmarks.forEach(pt => { allX.push(pt.x * canvasElement.width); allY.push(pt.y * canvasElement.height); });
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#FFFFFF', lineWidth: 2 });
        }

        if (fist && isCaptured) {
            resetCounter++;
            if (resetCounter > 40) { sounds.reset(); location.reload(); }
            canvasCtx.fillStyle = "red"; canvasCtx.fillRect(10, 10, resetCounter * 5, 15);
        } else { resetCounter = 0; }

        if (!isCaptured && results.multiHandLandmarks.length === 2) {
            const rect = { x: Math.min(...allX), y: Math.min(...allY), w: Math.max(...allX) - Math.min(...allX), h: Math.max(...allY) - Math.min(...allY) };
            canvasCtx.strokeStyle = '#adff2f'; canvasCtx.setLineDash([10, 5]); canvasCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            if (pinches === 2 && !isCountingDown) startCountdown(rect);
            if (isCountingDown) {
                canvasCtx.save(); canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);
                canvasCtx.fillStyle = "#adff2f"; canvasCtx.font = "bold 100px sans-serif"; canvasCtx.textAlign = "center";
                canvasCtx.fillText(countdownValue, canvasElement.width / 2, canvasElement.height / 2); canvasCtx.restore();
            }
        }

        if (isCaptured && results.multiHandLandmarks.length > 0) {
            const hand = results.multiHandLandmarks[0];
            const cursorX = hand[8].x * canvasElement.width, cursorY = hand[8].y * canvasElement.height;
            if (getDist(hand[4], hand[8]) < 0.06) {
                if (!grabbedPiece) grabbedPiece = pieces.find(p => !p.isLocked && cursorX > p.x && cursorX < p.x + p.w && cursorY > p.y && cursorY < p.y + p.h);
                if (grabbedPiece) { grabbedPiece.x = lerp(grabbedPiece.x, cursorX - grabbedPiece.w/2, 0.3); grabbedPiece.y = lerp(grabbedPiece.y, cursorY - grabbedPiece.h/2, 0.3); }
            } else if (grabbedPiece) {
                if (getDist({x: grabbedPiece.x, y: grabbedPiece.y}, {x: grabbedPiece.targetX, y: grabbedPiece.targetY}) < 40) {
                    grabbedPiece.x = grabbedPiece.targetX; grabbedPiece.y = grabbedPiece.targetY; grabbedPiece.isLocked = true; sounds.lock(); checkWin();
                }
                grabbedPiece = null;
            }
        }
    }
    pieces.forEach(p => { canvasCtx.drawImage(p.img, p.x, p.y); if(!p.isLocked) { canvasCtx.strokeStyle = "#adff2f"; canvasCtx.strokeRect(p.x, p.y, p.w, p.h); }});
    canvasCtx.restore();
}

function checkWin() {
    if (pieces.length > 0 && pieces.every(p => p.isLocked)) {
        clearInterval(timerInterval);
        const finalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        setTimeout(() => {
            const name = prompt(`TIME: ${finalTime}s. Enter Name:`);
            let scores = JSON.parse(localStorage.getItem('pScores') || '[]');
            scores.push({name, time: parseFloat(finalTime)}); scores.sort((a,b) => a.time - b.time);
            localStorage.setItem('pScores', JSON.stringify(scores.slice(0,5)));
            document.getElementById('score-list').innerHTML = scores.slice(0,5).map(s => `<div class="score-item"><span>${s.name}</span><span>${s.time}s</span></div>`).join('');
            document.getElementById('leaderboard').style.display = 'block';
        }, 500);
    }
}

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
hands.onResults(onResults);

function initGame() {
    audioCtx.resume();
    document.getElementById('start-screen').style.display = 'none';
    const camera = new Camera(videoElement, { onFrame: async () => {
        canvasElement.width = videoElement.videoWidth; canvasElement.height = videoElement.videoHeight;
        await hands.send({ image: videoElement });
    }});
    camera.start();
}