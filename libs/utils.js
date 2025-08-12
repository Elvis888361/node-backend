require('dotenv').config();
const pdfPoppler = require('pdf-poppler');
const tesseract = require('node-tesseract-ocr');
const { OpenAI} = require('openai');
const axios = require('axios');
async function convertPDFToImage(pdfPath, outputPath) {
    const options = {
        format: 'jpeg',
        out_dir: outputPath,
        out_prefix: 'page',
        page: 1,
        scale: 3000
    };
    await pdfPoppler.convert(pdfPath, options);
}

async function performOCR(imagePath) {
    // Perform OCR on the image file
    process.env.TESSDATA_PREFIX = 'C:\\Program Files\\Tesseract-OCR\\tessdata';
    return await tesseract.recognize(imagePath, {
        lang: 'eng',  //deu
        oem: 1,
        psm: 3
    });
}



async function structuredData(text) {
  const openai = new OpenAI({
    apiKey: "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"
});
    const prompt = `Hi, I am going to convert extracting data from pdf using Tesseract to structured json data 
    like .{ 
      "sender": { 
      "company": "", 
      "address": "", 
     "postcode":"", 
     "city":"", 
     "country":"", 
      "phone": "", 
      "fax": "", 
      "email": "", 
      "vat_number": ".", 
      "kvk_number": "" 
      }, 
      "recipient" : { 
      "company": "", 
      "attention_to": "", 
      "address": "", 
     "postcode":"", 
     "city":"", 
     "country":"", 
     "debtor_number":"" 
      }, 
      "sender_country": "", 
      "invoice" : { 
      "date": "", 
      "invoice_number": "", 
     "order_number": "", 
      "paid": true,
      "payment_method": "", 
      "currency": "" ,
      "tax": "" , 
      "total_amount_incl_vat": , 
      "subtotal_amount_excl_vat": , 
      "vat_amount_item":, 
      "items" : [ 
      { 
      "article_number": "", 
      "name": "", 
      "quantity": , 
      "item_unit_price": , 
      "item_amount_excl_vat": , 
      "item_vat_percentage": "", 
      "item_amount_incl_vat":, 
      "item_vat_amount":
      }, 
      ...
      ] 
      }
     }
     If key value is not exist of extracted data, give me space.
    This is extracting data :;`
    const completion = await openai.chat.completions.create({
      messages: [{ role: "system", content:prompt+text}],
      model: "gpt-3.5-turbo",
    });
  
    return completion.choices[0].message['content'];
  }
  async function getTotal(text) {
    const openai = new OpenAI({
      apiKey: "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"
  });
      const prompt = `Hi, I am going to convert extracting data from pdf using Tesseract to structured json data.
      You must give me only data  
      like .{  
        "total_amount_incl_vat": , 
        "subtotal_amount_excl_vat": , 
        "vat_amount_item":, 
       }
       If key value is not exist of extracted data, give me space.
      This is extracting data :;`
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content:prompt+text}],
        model: "gpt-3.5-turbo",
      });
    
      return completion.choices[0].message['content'];
    }
async function getInfofromKVKNumber(kvknumber){
  const apiUrl = 'https://api.overheid.io/openkvk/';
  const apiKey = process.env.KVK_API_KEY; // Fetch API key from environment variables
  const params = {
      filters: { dossiernummer: kvknumber },
      fields: ["Dossiernummer","Plaats","Bestaande handelsnaam","Straat","Postcode","HuisNummer"]
  };

  try {
      const response = await axios.get(apiUrl, {
          headers: {
              'ovio-api-key': apiKey
          },
          params: params
      });
      const companyData = response.data._embedded.bedrijf.map(b => ({
        Dossiernummer: b.dossiernummer,
        Plaats: b.plaats,
        "Bestaande handelsnaam": b.handelsnaam,
        Straat: b.straat,
        Postcode: b.postcode,
        HuisNummer: b.huisnummer
    }));
    return companyData;
  } catch (error) {
      res.status(500).send('Failed to fetch data from KVK API: ' + error.message);
  }
}

module.exports = {
    convertPDFToImage,
    performOCR,
    structuredData,
    getInfofromKVKNumber,
    getTotal
};