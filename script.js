const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const timerDisplay = document.getElementById('timer');
const flashElement = document.getElementById('flash');

let audioCtx, pieces = [], slots = [], grabbedPiece = null;
let isCaptured = false, isCountingDown = false, lockedRect = null;
let countdownValue = 3, countdownTimer = null, startTime, timerInterval;
const rows = 3, cols = 3;

// --- Performance Optimized Hands ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0, // CRITICAL: 0 makes it work on Android/iOS without lag
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
const lerp = (a, b, t) => a + (b - a) * t;

function snapPhoto(rect) {
    isCaptured = true;
    const pW = rect.w / cols; const pH = rect.h / rows;
    for (let i = 0; i < 9; i++) slots.push({ x: rect.x + (i % cols) * pW, y: rect.y + Math.floor(i / cols) * pH, index: i });
    
    let indices = [...Array(9).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const temp = document.createElement('canvas');
        temp.width = pW; temp.height = pH;
        const sX = (videoElement.videoWidth - (rect.x + rect.w)) + (c * pW);
        temp.getContext('2d').drawImage(videoElement, sX, rect.y + (r * pH), pW, pH, 0, 0, pW, pH);
        pieces.push({ img: temp, currentSlot: indices[i], targetSlot: i, x: slots[indices[i]].x, y: slots[indices[i]].y, w: pW, h: pH });
    }
    document.getElementById('phase-title').innerText = "PHASE 2: SOLVE";
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const ms = Date.now() - startTime;
        timerDisplay.innerText = `${Math.floor(ms/60000).toString().padStart(2,'0')}:${(Math.floor(ms/1000)%60).toString().padStart(2,'0')}.${(ms%1000).toString().substring(0,2)}`;
    }, 50);
}

function onResults(results) {
    // 1. Clear and Mirror
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.translate(canvasElement.width, 0); canvasCtx.scale(-1, 1);
    
    // 2. Draw Background Video
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks) {
        let allX = [], allY = [], pinches = 0;
        
        for (const landmarks of results.multiHandLandmarks) {
            // Draw skeleton landmarks so we know it's working
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#adff2f', lineWidth: 2});
            drawLandmarks(canvasCtx, landmarks, {color: '#ffffff', lineWidth: 1, radius: 2});

            const t = landmarks[4], i = landmarks[8];
            if (getDist(t, i) < 0.08) pinches++; 
            landmarks.forEach(p => { allX.push(p.x * canvasElement.width); allY.push(p.y * canvasElement.height); });
        }

        // Logic: Framing
        if (!isCaptured && results.multiHandLandmarks.length === 2 && !isCountingDown) {
            lockedRect = { x: Math.min(...allX), y: Math.min(...allY), w: Math.max(...allX)-Math.min(...allX), h: Math.max(...allY)-Math.min(...allY) };
            if (pinches === 2) {
                isCountingDown = true; countdownValue = 3;
                countdownTimer = setInterval(() => {
                    countdownValue--;
                    if (countdownValue <= 0) {
                        clearInterval(countdownTimer); isCountingDown = false;
                        flashElement.style.opacity='1'; setTimeout(()=>flashElement.style.opacity='0',100);
                        snapPhoto(lockedRect);
                    }
                }, 1000);
            }
        }

        // Logic: Solve
        if (isCaptured && results.multiHandLandmarks.length > 0) {
            const h = results.multiHandLandmarks[0];
            const cX = h[8].x * canvasElement.width, cY = h[8].y * canvasElement.height;
            if (getDist(h[4], h[8]) < 0.08) {
                if (!grabbedPiece) grabbedPiece = pieces.find(p => cX > p.x && cX < p.x + p.w && cY > p.y && cY < p.y + p.h);
                if (grabbedPiece) { 
                    grabbedPiece.x = lerp(grabbedPiece.x, cX - grabbedPiece.w/2, 0.4); 
                    grabbedPiece.y = lerp(grabbedPiece.y, cY - grabbedPiece.h/2, 0.4); 
                }
            } else if (grabbedPiece) {
                const near = slots.find(s => getDist({x: grabbedPiece.x+grabbedPiece.w/2, y: grabbedPiece.y+grabbedPiece.h/2}, {x: s.x+grabbedPiece.w/2, y: s.y+grabbedPiece.h/2}) < grabbedPiece.w/1.2);
                if (near) {
                    const other = pieces.find(p => p.currentSlot === near.index);
                    const oldIdx = grabbedPiece.currentSlot;
                    grabbedPiece.currentSlot = near.index; if (other) other.currentSlot = oldIdx;
                }
                pieces.forEach(p => { p.x = slots[p.currentSlot].x; p.y = slots[p.currentSlot].y; });
                grabbedPiece = null;
                if (pieces.every(p => p.currentSlot === p.targetSlot)) {
                    clearInterval(timerInterval);
                    document.getElementById('leaderboard').style.display = 'block';
                    document.getElementById('score-list').innerText = "Time: " + timerDisplay.innerText;
                }
            }
        }
    }

    // Draw Puzzle Pieces
    pieces.forEach(p => { 
        canvasCtx.drawImage(p.img, p.x, p.y); 
        canvasCtx.strokeStyle = "rgba(255,255,255,0.3)";
        canvasCtx.strokeRect(p.x, p.y, p.w, p.h); 
    });
    
    // Draw framing box
    if (lockedRect && !isCaptured) {
        canvasCtx.strokeStyle = "#adff2f"; canvasCtx.lineWidth = 3;
        canvasCtx.strokeRect(lockedRect.x, lockedRect.y, lockedRect.w, lockedRect.h);
    }

    canvasCtx.restore();
}

hands.onResults(onResults);

async function initGame() {
    if (typeof Camera === 'undefined') { alert("AI Engine still loading..."); return; }
    
    try {
        // Essential for mobile audio/video
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();

        document.getElementById('start-screen').style.display = 'none';

        const camera = new Camera(videoElement, {
            onFrame: async () => {
                // FORCE RESIZE: If video resolution changes or starts late
                if (videoElement.videoWidth > 0) {
                    canvasElement.width = videoElement.videoWidth;
                    canvasElement.height = videoElement.videoHeight;
                    await hands.send({ image: videoElement });
                }
            },
            width: 640, height: 480 // Stable mobile resolution
        });
        camera.start();
    } catch (e) { alert("Init Error: " + e); }
}
