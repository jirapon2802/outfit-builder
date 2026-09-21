"""Copy beside app.py in an official FastFit checkout; use as Gradio app_file.

Optional ZeroGPU needs a compatible GPU runtime and `spaces` installed. This
adapter has not been validated on GPU hardware in the development environment.
"""
import os

import gradio as gr
from app import FastFitDemo

engine = FastFitDemo(device="cuda")


def generate(person, top, bottom, shoes):
    if any(image is None for image in (person, top, bottom, shoes)):
        raise gr.Error("A model, top, bottom, and shoes are required.")
    result, status = engine.generate_image(
        person, top, bottom, None, shoes, None,
        ref_height=512, num_inference_steps=30, guidance_scale=2.5,
        use_square_mask=False, seed=42, enable_pose=True,
    )
    if result is None:
        raise gr.Error(status)
    return result


if os.environ.get("USE_ZEROGPU") == "1":
    import spaces
    generate = spaces.GPU(duration=120)(generate)

with gr.Blocks(delete_cache=(3600, 3600)) as demo:
    gr.Markdown("# Outfit Builder · personal FastFit endpoint")
    person = gr.Image(type="pil", label="Reference model")
    top = gr.Image(type="pil", label="Top")
    bottom = gr.Image(type="pil", label="Bottom")
    shoes = gr.Image(type="pil", label="Shoes")
    output = gr.Image(type="pil", format="png", label="Outfit")
    gr.Button("Generate").click(generate, [person, top, bottom, shoes], output, api_name="try_on", concurrency_limit=1)

demo.queue(max_size=5).launch(server_name="0.0.0.0", server_port=7860, show_error=True)
