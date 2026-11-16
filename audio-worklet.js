// The browser's end of the emulator's sound output.
//
// An AudioWorkletProcessor runs on the audio thread, woken by the audio
// hardware every 128 frames, and must return its 128 frames without ever
// blocking. The emulator runs on the main thread inside requestAnimationFrame,
// in bursts of a whole emulated frame at a time. The two cannot call each
// other, so everything between them goes through this queue.
//
// WebMain posts interleaved stereo Float32Array chunks; process() hands them
// to the speakers 128 frames at a time. The queue is what absorbs the mismatch
// between one burst of ~738 frames every 16.7ms and a steady demand for 128.
//
// Deliberately a list of chunks rather than a ring buffer: a ring has to cope
// with a writer that laps the reader, and the failure is silent corruption.
// Here an over-eager writer only grows an array, which WebMain is watching for
// and throttles on. Running dry is the normal failure instead, and it emits
// silence, which is audible but harmless.
//
// This file is not compiled by TeaVM -- it is copied verbatim into the build
// by the webApp task, and loaded with audioWorklet.addModule().

class PaulaGirlProcessor extends AudioWorkletProcessor {

    constructor() {
        super();
        this.chunks = [];   // Float32Array, interleaved L,R,L,R...
        this.offset = 0;    // read position inside chunks[0], in array indices
        this.port.onmessage = (event) => {
            if (event.data === null) {
                // Flush: a reset or a save-state load makes everything already
                // queued wrong, and playing it out would be ~90ms of the old
                // game after the new one has started.
                this.chunks.length = 0;
                this.offset = 0;
                return;
            }
            this.chunks.push(event.data);
        };
    }

    process(inputs, outputs) {
        const output = outputs[0];
        const left = output[0];
        const right = output[1];

        for (let i = 0; i < left.length; i++) {
            const chunk = this.chunks[0];
            if (chunk === undefined) {
                // Underrun. Silence is the only honest answer: repeating the
                // last sample would buzz, and there is nothing to interpolate
                // towards because the next sample does not exist yet.
                left[i] = 0;
                right[i] = 0;
                continue;
            }
            left[i] = chunk[this.offset];
            right[i] = chunk[this.offset + 1];
            this.offset += 2;
            if (this.offset >= chunk.length) {
                this.chunks.shift();
                this.offset = 0;
            }
        }

        // Never return false: that would end the node permanently, and the
        // queue being momentarily empty is normal, not the end of the stream.
        return true;
    }
}

registerProcessor('paulagirl-apu', PaulaGirlProcessor);
