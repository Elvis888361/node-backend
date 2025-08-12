import os
import uuid
import io
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
import fitz
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

def extract_images_from_page(pdf_path, page_num):
    doc = fitz.open(pdf_path)  # Open the PDF file using fitz
    page = doc.load_page(page_num) # Load the page and get all images on the page
    images = page.get_images(full=True)
    extracted_images = []

    # Loop through each image and extract it
    for img in images:
        xref = img[0]
        base_image = doc.extract_image(xref)
        image_bytes = base_image["image"]

        # Save the image bytes to a PIL.Image object
        img = Image.open(io.BytesIO(image_bytes))
        extracted_images.append(img)

    return extracted_images

@app.post("/upload_pdf/")
async def upload_pdf(file: UploadFile = File(...)):
    # Save the uploaded PDF to a temporary file
    pdf_path = f"./temp/{uuid.uuid4()}.pdf"
    with open(pdf_path, "wb") as f:
        f.write(await file.read())

    # Extract images from the PDF
    extracted_images = []
    doc = fitz.open(pdf_path)
    for page_num in range(len(doc)):
        images = extract_images_from_page(pdf_path, page_num)
        for img in images:
            # img_path = os.path.join("./images", f"{uuid.uuid4()}.png")
            img_path = os.path.join("./../M-factuur/src/assets/images", f"{uuid.uuid4()}.png")

            img.save(img_path)
            extracted_images.append(img_path)
    doc.close()  # Close the document to release the file

    # Clean up the temporary PDF file
    os.remove(pdf_path)
    image_urls = [f"/images/{os.path.basename(img_path)}" for img_path in extracted_images]
    return JSONResponse(content={"extracted_images": image_urls[-1]})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)