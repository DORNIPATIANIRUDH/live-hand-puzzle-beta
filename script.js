const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const timerDisplay = document.getElementById('timer');
const flashElement = document.getElementById('flash');

// --- Audio Logic ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(f, t, d) {
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = f; o.frequency.setValueAtTime(t, audioCtx.currentTime);
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + d);
}
const sfx = { 
    tick: () => playSound('sine', 800, 0.1), 
    snap: () => playSound('square', 200, 0.4), 
    swap: () => playSound('triangle', 500, 0.2),
    reset: () => playSound('sawtooth', 150, 0.3)
};

// --- Game Variables ---
let pieces = [], slots = [], grabbedPiece = null;
let isCaptured = false, isCountingDown = false, lockedRect = null;
let countdownValue = 3, countdownTimer = null, startTime, timerInterval, resetCounter = 0;
const rows = 3, cols = 3;

const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
const lerp = (a, b, t) => a + (b - a) * t;

function initGrid(rect) {
    slots = [];
    const pW = rect.w / cols; const pH = rect.h / rows;
    for (let i = 0; i < 9; i++) {
        slots.push({ x: rect.x + (i % cols) * pW, y: rect.y + Math.floor(i / cols) * pH, index: i });
    }
}

function snapPhoto(rect) {
    isCaptured = true;
    initGrid(rect);
    const pW = rect.w / cols; const pH = rect.h / rows;
    
    // Create & Shuffle
    let indices = [...Array(9).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / cols); const c = i % cols;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pW; tempCanvas.height = pH;
        const sX = (videoElement.videoWidth - (rect.x + rect.w)) + (c * pW);
        tempCanvas.getContext('2d').drawImage(videoElement, sX, rect.y + (r * pH), pW, pH, 0, 0, pW, pH);
        
        pieces.push({ 
            img: tempCanvas, currentSlot: indices[i], targetSlot: i, 
            x: slots[indices[i]].x, y: slots[indices[i]].y, w: pW, h: pH 
        });
    }

    // Update UI
    document.getElementById('phase-title').innerText = "Phase 2: Solve";
    document.getElementById('p-step-1').innerHTML = "1. Pinch to Pick Up";
    document.getElementById('p-step-2').innerHTML = "2. Drop to Swap Blocks";
    
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const ms = Date.now() - startTime;
        timerDisplay.innerText = `${Math.floor(ms/60000).toString().padStart(2,'0')}:${(Math.floor(ms/1000)%60).toString().padStart(2,'0')}.${(ms%1000).toString().substring(0,2)}`;
    }, 50);
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks) {
        let allX = [], allY = [], pinches = 0, fist = false;
        for (const landmarks of results.multiHandLandmarks) {
            const t = landmarks[4], i = landmarks[8];
            if (getDist(t, i) < 0.05) pinches++;
            if (landmarks[8].y > landmarks[6].y && landmarks[12].y > landmarks[10].y) fist = true;
            landmarks.forEach(p => { allX.push(p.x * canvasElement.width); allY.push(p.y * canvasElement.height); });
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#adff2f', lineWidth: 2 });
        }

        // --- Logic: Reset ---
        if (fist && isCaptured) {
            resetCounter++;
            if (resetCounter > 40) location.reload();
            canvasCtx.fillStyle = "#adff2f"; canvasCtx.fillRect(0, canvasElement.height-10, (resetCounter/40)*canvasElement.width, 10);
        } else resetCounter = 0;

        // --- Logic: Framing ---
        if (!isCaptured) {
            if (results.multiHandLandmarks.length === 2 && !isCountingDown) {
                lockedRect = { x: Math.min(...allX), y: Math.min(...allY), w: Math.max(...allX)-Math.min(...allX), h: Math.max(...allY)-Math.min(...allY) };
                if (pinches === 2) {
                    isCountingDown = true; countdownValue = 3; sfx.tick();
                    countdownTimer = setInterval(() => {
                        countdownValue--; sfx.tick();
                        if (countdownValue <= 0) {
                            clearInterval(countdownTimer); isCountingDown = false;
                            flashElement.style.opacity = '1'; setTimeout(()=>flashElement.style.opacity='0',100);
                            sfx.snap(); snapPhoto(lockedRect);
                        }
                    }, 1000);
                }
            }
            if (lockedRect) {
                canvasCtx.strokeStyle = "#adff2f"; canvasCtx.lineWidth = 4;
                if (!isCountingDown) canvasCtx.setLineDash([10, 5]); else canvasCtx.setLineDash([]);
                canvasCtx.strokeRect(lockedRect.x, lockedRect.y, lockedRect.w, lockedRect.h);
            }
            if (isCountingDown) {
                canvasCtx.save(); canvasCtx.translate(canvasElement.width,0); canvasCtx.scale(-1,1);
                canvasCtx.fillStyle = "#adff2f"; canvasCtx.font = "bold 100px sans-serif"; canvasCtx.textAlign="center";
                canvasCtx.fillText(countdownValue, canvasElement.width/2, canvasElement.height/2); canvasCtx.restore();
            }
        }

        // --- Logic: Solve/Swap ---
        if (isCaptured && results.multiHandLandmarks.length > 0) {
            const h = results.multiHandLandmarks[0];
            const cX = h[8].x * canvasElement.width; const cY = h[8].y * canvasElement.height;
            if (getDist(h[4], h[8]) < 0.05) {
                if (!grabbedPiece) grabbedPiece = pieces.find(p => cX > p.x && cX < p.x + p.w && cY > p.y && cY < p.y + p.h);
                if (grabbedPiece) { 
                    grabbedPiece.x = lerp(grabbedPiece.x, cX - grabbedPiece.w/2, 0.3); 
                    grabbedPiece.y = lerp(grabbedPiece.y, cY - grabbedPiece.h/2, 0.3); 
                }
            } else if (grabbedPiece) {
                const near = slots.find(s => getDist({x: grabbedPiece.x+grabbedPiece.w/2, y: grabbedPiece.y+grabbedPiece.h/2}, {x: s.x+grabbedPiece.w/2, y: s.y+grabbedPiece.h/2}) < grabbedPiece.w/1.5);
                if (near) {
                    const other = pieces.find(p => p.currentSlot === near.index);
                    const oldIdx = grabbedPiece.currentSlot;
                    grabbedPiece.currentSlot = near.index;
                    if (other) other.currentSlot = oldIdx;
                    sfx.swap();
                }
                pieces.forEach(p => { p.x = slots[p.currentSlot].x; p.y = slots[p.currentSlot].y; });
                grabbedPiece = null;
                if (pieces.every(p => p.currentSlot === p.targetSlot)) {
                    clearInterval(timerInterval);
                    document.getElementById('leaderboard').style.display = 'block';
                    document.getElementById('score-list').innerText = "Clear Time: " + timerDisplay.innerText;
                }
            }
        }
    }
    pieces.forEach(p => { 
        canvasCtx.drawImage(p.img, p.x, p.y);
        canvasCtx.strokeStyle = "white"; canvasCtx.lineWidth = 2; canvasCtx.strokeRect(p.x, p.y, p.w, p.h);
    });
    canvasCtx.restore();
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