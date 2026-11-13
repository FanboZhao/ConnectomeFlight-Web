# Attribution

- **FlyVis** — upstream visual model and connectome used in the recordings. Visual responses are reconstructed from the archived binocular inputs through the retained upstream model.
- **FlyBody** — upstream fly body and low-level flight controller. Camera renders use MuJoCo and preserve the archived high-level actions.
- **ConnectomeFlight** — the research policies displayed here: ConnectomeFlight-V (115 trainable parameters, T4/T5 readout, fixed 104-dimensional compression and 50 ms EMA) and ConnectomeFlight-VO (Vis115 visual branch plus a 32-dimensional odor RNN and residual head, 2454 trainable parameters).
- Interface references: [fly-brain](https://github.com/Lulzx/fly-brain) and [Neural Canvas](https://huggingface.co/spaces/Xenova/fruit-fly-simulation). The retained fly-brain MIT notice is in [LICENSES/fly-brain-MIT.txt](LICENSES/fly-brain-MIT.txt).

Activity images show continuous model responses, not biological spikes or a complete anatomical brain. Selected successful replays do not establish aggregate performance or independent generalization.

This repository distributes a presentation interface, rendered media, quantized display colors and rounded replay readouts. Research code, model weights and precise intermediate activity arrays are excluded. Display color quantization supports interactive rotation and filtering without publishing learned parameter values.

Website code and presentation media are released under the [MIT License](LICENSE). Upstream FlyVis, FlyBody and fly-brain retain their original licenses.
