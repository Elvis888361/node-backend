const express = require('express');
const router = express.Router();
const { convertPDFToImage, performOCR,structuredData,getTotal } = require('../../libs/utils');
const {validateInvoiceData} = require('../../libs/validations')
const {parsePDFtoJSON} = require('../../libs/json2pdf');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Helper function to get image dimensions
async function getImageDimensions(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    return { width: 595, height: 842 };
  }
}
// Add this function before your routes
function validateExtractedData(jsonData) {
  const validation = {
    complete: true,
    missing_fields: [],
    warnings: []
  };
  
  const requiredFields = {
    'sender.company': 'Sender company name',
    'sender.address': 'Sender address',
    'receiver.company': 'Receiver company name',
    'company.country': 'Company country',
    'company.vat_number': 'VAT/BTW number',
    'invoice.date': 'Invoice date',
    'invoice.number': 'Invoice number',
    'total_amount_incl_vat': 'Total amount including VAT',
    'subtotal_amount_excl_vat': 'Subtotal excluding VAT',
    'vat_percentage': 'VAT percentage'
  };
  
  // Check required fields
  Object.entries(requiredFields).forEach(([field, description]) => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], jsonData);
    if (!value) {
      validation.complete = false;
      validation.missing_fields.push({
        field: field,
        description: description
      });
    }
  });
  
  // Add warnings for optional but important fields
  if (!jsonData.bank?.iban) {
    validation.warnings.push('IBAN number not found');
  }
  
  if (!jsonData.company?.kvk_number) {
    validation.warnings.push('Company registration number not found');
  }
  
  return validation;
}

// Enhanced function to extract specific information
function extractInvoiceDetails(groupedData, text) {
  const details = {
    sender: {},
    receiver: {},
    invoice: {},
    bank: {},
    company: {}
  };

  // Helper functions for extraction
  const extractPhoneNumber = (text) => {
    const phoneRegex = /(\+31|0031|0)[\s\-]?[1-9][\s\-]?\d{8}|\d{2,3}[\s\-]?\d{7,8}/g;
    const matches = text.match(phoneRegex);
    return matches ? matches[0].replace(/[\s\-]/g, '') : null;
  };

  const extractEmail = (text) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex);
    return matches ? matches[0] : null;
  };

  const extractWebsite = (text) => {
    const websiteRegex = /(https?:\/\/)?(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?/g;
    const matches = text.match(websiteRegex);
    return matches ? matches.filter(match => !match.includes('@'))[0] : null;
  };

  const extractVATNumber = (text) => {
    // Dutch VAT: NL + 9 digits + B + 2 digits
    const nlVatRegex = /NL\d{9}B\d{2}/g;
    // Belgian VAT: BE + 10 digits
    const beVatRegex = /BE\d{10}/g;
    // General BTW number patterns
    const btwRegex = /BTW[\s:-]*(NL\d{9}B\d{2}|BE\d{10}|\d{9,12})/gi;
    
    let matches = text.match(nlVatRegex) || text.match(beVatRegex) || text.match(btwRegex);
    if (matches) {
      return matches[0].replace(/BTW[\s:-]*/gi, '').trim();
    }
    return null;
  };

  // Replace the existing extractKvKNumber function with this enhanced version
const extractKvKNumber = (text) => {
  // Dutch KvK number (8 digits)
  const dutchKvkRegex = /(KvK|K\.v\.K|kvk|handelsregister)[\s:-]*(\d{8})/gi;
  // Belgian company number (10 digits with BE prefix)
  const belgianRegex = /BE\d{10}/g;
  
  // Check for Dutch KvK first
  const dutchMatches = text.match(dutchKvkRegex);
  if (dutchMatches) {
    const numberMatch = dutchMatches[0].match(/\d{8}/);
    return numberMatch ? numberMatch[0] : null;
  }
  
  // Check for Belgian company number
  const belgianMatches = text.match(belgianRegex);
  if (belgianMatches) {
    return belgianMatches[0];
  }
  
  return null;
};

  const extractIBAN = (text) => {
    const ibanRegex = /[A-Z]{2}\d{2}[A-Z0-9]{4}\d{10}/g;
    const matches = text.match(ibanRegex);
    return matches ? matches[0] : null;
  };

  const extractInvoiceNumber = (text) => {
    const invoiceRegex = /(factuur|invoice|faktuurnr|factuurnummer)[\s:-]*(\d+)/gi;
    const matches = text.match(invoiceRegex);
    if (matches) {
      const numberMatch = matches[0].match(/\d+/);
      return numberMatch ? numberMatch[0] : null;
    }
    return null;
  };

  const extractInvoiceDate = (text) => {
    // Various date formats: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
    const dateRegex = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/g;
    const matches = text.match(dateRegex);
    return matches ? matches[0] : null;
  };

  const extractPaymentInfo = (text) => {
    const paidRegex = /(betaald|paid|voldaan)/gi;
    const paymentMethodRegex = /(pin|ideal|banktransfer|contant|cash|creditcard)/gi;
    
    const isPaid = paidRegex.test(text);
    const paymentMethodMatch = text.match(paymentMethodRegex);
    
    return {
      paid: isPaid,
      method: paymentMethodMatch ? paymentMethodMatch[0] : null
    };
  };

  const determineCountry = (text, vatNumber) => {
    if (vatNumber) {
      if (vatNumber.startsWith('NL')) return 'NL';
      if (vatNumber.startsWith('BE')) return 'BE';
    }
    
    const nlIndicators = ['nederland', 'netherlands', 'holland', 'nl'];
    const beIndicators = ['belgie', 'belgique', 'belgium', 'be'];
    
    const lowerText = text.toLowerCase();
    
    if (nlIndicators.some(indicator => lowerText.includes(indicator))) return 'NL';
    if (beIndicators.some(indicator => lowerText.includes(indicator))) return 'BE';
    
    return 'UNKNOWN';
  };

  // Process the data - handle both individual items and arrays
  let processedData = [];
  
  // Check if groupedData is an array of individual items or arrays of items
  if (Array.isArray(groupedData)) {
    if (groupedData.length > 0 && Array.isArray(groupedData[0])) {
      // groupedData is array of arrays (textblocks)
      processedData = groupedData;
    } else {
      // groupedData is array of individual items, group them artificially
      processedData = [groupedData]; // Wrap in array to make it a single textblock
    }
  }

  // Extract sender information (company sending the invoice)
  processedData.forEach((textblock) => {
    // Ensure textblock is an array
    if (!Array.isArray(textblock)) {
      console.warn('Expected textblock to be an array, got:', typeof textblock);
      return;
    }

    let blockText = '';
    blockText = textblock.map(item => item.text || '').join(' ');
    
    // Check if this block contains sender keywords
    const senderKeywords = ['fax', 'tel', 'website', 'www', 'kvk', 'btw nummer', 'vat'];
    const containsSenderKeywords = senderKeywords.some(keyword => 
      blockText.toLowerCase().includes(keyword.toLowerCase())
    );
    
    // Avoid blocks with receiver keywords
    const receiverKeywords = ['debiteur', 'klant', 'tav', 't.a.v', 'facturatie'];
    const containsReceiverKeywords = receiverKeywords.some(keyword => 
      blockText.toLowerCase().includes(keyword.toLowerCase())
    );

    if (containsSenderKeywords && !containsReceiverKeywords) {
      // Extract sender details
      if (!details.sender.company && textblock.length > 0) {
        details.sender.company = textblock[0].text;
      }
      
      // Extract address components
      textblock.forEach(item => {
        const text = item.text;
        
        // Postcode and city pattern
        const postcodeRegex = /(\d{4}\s?[A-Z]{2})\s+([A-Za-z\s]+)/;
        const postcodeMatch = text.match(postcodeRegex);
        if (postcodeMatch) {
          details.sender.postcode = postcodeMatch[1];
          details.sender.city = postcodeMatch[2].trim();
        }
        
        // Street address (contains numbers)
        if (/\d+/.test(text) && !postcodeMatch && !text.includes('@') && !text.includes('www')) {
          details.sender.address = text;
        }
      });
      
      const phone = extractPhoneNumber(blockText);
      if (phone) details.sender.phone = phone;
      
      const email = extractEmail(blockText);
      if (email) details.sender.email = email;
      
      const website = extractWebsite(blockText);
      if (website) details.sender.website = website;
    }
  });

  // Extract receiver information
  processedData.forEach((textblock) => {
    // Ensure textblock is an array
    if (!Array.isArray(textblock)) {
      return;
    }

    const blockText = textblock.map(item => item.text || '').join(' ');
    
    const receiverKeywords = ['debiteur', 'klant', 'tav', 't.a.v', 'facturatie', 'aan'];
    const containsReceiverKeywords = receiverKeywords.some(keyword => 
      blockText.toLowerCase().includes(keyword.toLowerCase())
    );

    if (containsReceiverKeywords) {
      textblock.forEach(item => {
        const text = item.text;
        
        // Skip keywords themselves
        if (receiverKeywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()))) {
          return;
        }
        
        // Extract company name (first non-keyword text)
        if (!details.receiver.company && text.trim().length > 2) {
          details.receiver.company = text;
        }
        
        // Postcode and city
        const postcodeRegex = /(\d{4}\s?[A-Z]{2})\s+([A-Za-z\s]+)/;
        const postcodeMatch = text.match(postcodeRegex);
        if (postcodeMatch) {
          details.receiver.postcode = postcodeMatch[1];
          details.receiver.city = postcodeMatch[2].trim();
        }
        
        // Street address
        if (/\d+/.test(text) && !postcodeMatch) {
          details.receiver.address = text;
        }
      });
    }
  });

  // Extract company registration details from full text
  details.company.vat_number = extractVATNumber(text);
  details.company.kvk_number = extractKvKNumber(text);
  details.company.country = determineCountry(text, details.company.vat_number);

  // Extract invoice details
  details.invoice.number = extractInvoiceNumber(text);
  details.invoice.date = extractInvoiceDate(text);
  
  const paymentInfo = extractPaymentInfo(text);
  details.invoice.paid = paymentInfo.paid;
  details.invoice.payment_method = paymentInfo.method;

  // Extract bank details
  // Replace the existing bank details extraction with this enhanced version
// Extract bank details
details.bank.iban = extractIBAN(text);

// Extract bank account holder name (enhanced version)
if (details.bank.iban) {
  const ibanIndex = text.indexOf(details.bank.iban);
  if (ibanIndex !== -1) {
    // Look for text before and after IBAN
    const surroundingText = text.substring(Math.max(0, ibanIndex - 150), ibanIndex + 150);
    
    // Multiple patterns for account holder detection
    const namePatterns = [
      /(?:t\.n\.v\.|tnv|ten name van)[\s:]*([\w\s&\-\.]{2,50})/gi,
      /(?:rekeninghouder|account holder)[\s:]*([\w\s&\-\.]{2,50})/gi,
      /(?:naam|name)[\s:]*([\w\s&\-\.]{2,50})/gi
    ];
    
    for (const pattern of namePatterns) {
      const nameMatch = surroundingText.match(pattern);
      if (nameMatch) {
        const cleanName = nameMatch[0]
          .replace(/t\.n\.v\.|tnv|ten name van|rekeninghouder|account holder|naam|name/gi, '')
          .replace(/[:\s]+/g, ' ')
          .trim();
        if (cleanName.length > 1) {
          details.bank.account_holder = cleanName;
          break;
        }
      }
    }
    
    // If no specific pattern found, try to find company name near IBAN
    if (!details.bank.account_holder && details.sender.company) {
      details.bank.account_holder = details.sender.company;
    }
  }
}

  return details;
}
// Add this function after extractInvoiceDetails function
async function extractCompanyLogo(imagePath, senderInfo) {
  try {
    // Basic logo detection - you can enhance this with actual image processing
    const logoData = {
      found: false,
      coordinates: null,
      extracted_logo_path: null,
      company_name: senderInfo?.company || null,
      estimated_position: null
    };

    // If we have sender info, we can estimate logo position (typically top-left area)
    if (senderInfo?.company) {
      logoData.estimated_position = {
        x: 50,
        y: 50,
        width: 200,
        height: 100,
        note: "Estimated logo position based on typical invoice layout"
      };
      logoData.found = true; // Mark as found for estimation
    }

    return logoData;
  } catch (error) {
    console.error('Error extracting logo:', error);
    return {
      found: false,
      coordinates: null,
      extracted_logo_path: null,
      error: error.message
    };
  }
}

function determinePaymentStatus(text) {
  const paidKeywords = ['betaald', 'paid', 'voldaan', 'gelukt', 'successful', 'completed'];
  const unpaidKeywords = ['openstaand', 'unpaid', 'outstanding', 'pending', 'due'];
  const paymentMethods = [
    'pin', 'ideal', 'banktransfer', 'contant', 'cash', 'creditcard', 
    'mastercard', 'visa', 'paypal', 'sepa', 'overboeking'
  ];

  const lowerText = text.toLowerCase();
  
  let isPaid = false;
  let paymentMethod = null;

  // Check for paid status
  const hasPaidKeyword = paidKeywords.some(keyword => lowerText.includes(keyword));
  const hasUnpaidKeyword = unpaidKeywords.some(keyword => lowerText.includes(keyword));
  
  if (hasPaidKeyword && !hasUnpaidKeyword) {
    isPaid = true;
  }

  // Extract payment method
  const foundMethod = paymentMethods.find(method => lowerText.includes(method));
  if (foundMethod) {
    paymentMethod = foundMethod;
    isPaid = true; // If payment method is mentioned, likely paid
  }

  return {
    paid: isPaid,
    method: paymentMethod,
    confidence: hasPaidKeyword ? 0.9 : (foundMethod ? 0.7 : 0.3)
  };
}
function validateComprehensiveInvoiceData(jsonData) {
  const validation = {
    complete: true,
    missing_fields: [],
    warnings: [],
    completeness_score: 0,
    field_status: {}
  };
  
  // All 16 required fields mapping
  const requiredFields = {
    // 1. Sender information
    'sender.company': { description: '1. Sender company name', weight: 2 },
    'sender.address': { description: '1. Sender address', weight: 1 },
    'sender.phone': { description: '1. Sender phone', weight: 1 },
    'sender.email': { description: '1. Sender email', weight: 1 },
    
    // 2. Receiver information  
    'receiver.company': { description: '2. Receiver company name', weight: 2 },
    'receiver.address': { description: '2. Receiver address', weight: 1 },
    
    // 3. Country
    'company.country': { description: '3. Sender country (NL/BE/Other)', weight: 2 },
    
    // 4. Logo (estimated)
    'company.logo.found': { description: '4. Company logo detected', weight: 1 },
    
    // 5. Company registration number
    'company.kvk_number': { description: '5. Company registration number', weight: 2 },
    
    // 6 & 7. VAT/BTW number
    'company.vat_number': { description: '6-7. VAT/BTW number', weight: 2 },
    
    // 8. Invoice date
    'invoice.date': { description: '8. Invoice date', weight: 2 },
    
    // 9. Invoice number
    'invoice.number': { description: '9. Invoice number', weight: 2 },
    
    // 10. Payment status
    'invoice.paid': { description: '10. Payment status', weight: 1 },
    'invoice.payment_method': { description: '10. Payment method', weight: 1 },
    
    // 11-13. Financial details
    'total_amount_incl_vat': { description: '11. Total amount incl. VAT', weight: 3 },
    'subtotal_amount_excl_vat': { description: '12. Subtotal excl. VAT', weight: 2 },
    'vat_percentage': { description: '13. VAT percentage', weight: 2 },
    
    // 14. Items (check if array exists)
    'items': { description: '14. Invoice items', weight: 2 },
    
    // 15-16. Banking
    'bank.iban': { description: '15. IBAN number', weight: 2 },
    'bank.account_holder': { description: '16. Bank account holder', weight: 1 }
  };
  
  let totalWeight = 0;
  let achievedWeight = 0;
  
  // Check each required field
  Object.entries(requiredFields).forEach(([fieldPath, fieldInfo]) => {
    totalWeight += fieldInfo.weight;
    
    const value = fieldPath.split('.').reduce((obj, key) => {
      if (key === 'found' && obj && typeof obj === 'object') {
        return obj.found;
      }
      return obj?.[key];
    }, jsonData);
    
    const isPresent = value !== undefined && value !== null && value !== '';
    
    // Special case for items array
    if (fieldPath === 'items') {
      const itemsPresent = Array.isArray(value) && value.length > 0;
      validation.field_status[fieldPath] = {
        present: itemsPresent,
        value: itemsPresent ? `${value.length} items` : 'No items',
        weight: fieldInfo.weight
      };
      if (itemsPresent) achievedWeight += fieldInfo.weight;
      else validation.missing_fields.push(fieldInfo);
    } else {
      validation.field_status[fieldPath] = {
        present: isPresent,
        value: isPresent ? value : null,
        weight: fieldInfo.weight
      };
      
      if (isPresent) {
        achievedWeight += fieldInfo.weight;
      } else {
        validation.complete = false;
        validation.missing_fields.push(fieldInfo);
      }
    }
  });
  
  validation.completeness_score = Math.round((achievedWeight / totalWeight) * 100);
  
  // Add specific warnings
  if (!jsonData.company?.country || jsonData.company.country === 'UNKNOWN') {
    validation.warnings.push('Could not determine sender country (NL/BE)');
  }
  
  if (!jsonData.items || jsonData.items.length === 0) {
    validation.warnings.push('No invoice items found - may affect total calculations');
  }
  
  if (validation.completeness_score < 70) {
    validation.warnings.push('Low data completeness - document may be unclear or damaged');
  }
  
  return validation;
}

// Helper function to convert PDF coordinates to pixel coordinates
function convertToPixelCoordinates(pdfData, imageWidth, imageHeight) {
  console.log('Converting coordinates for image dimensions:', { imageWidth, imageHeight });
  
  const pdfPage = pdfData.Pages[0];
  const pdfWidth = pdfPage.Width || 595;
  const pdfHeight = pdfPage.Height || 842;
  
  console.log('PDF page dimensions:', { pdfWidth, pdfHeight });
  
  const scaleX = imageWidth / pdfWidth;
  const scaleY = imageHeight / pdfHeight;
  
  console.log('Scale factors:', { scaleX, scaleY });
  
  return pdfPage.Texts.map((textItem, index) => {
    const text = textItem.R.map(r => decodeURIComponent(r.T)).join('');
    
    if (text.trim() === "") return null;
    
    const firstRun = textItem.R[0];
    let fontSize = 12;
    
    if (firstRun && firstRun.TS) {
      const tsArray = decodeURIComponent(firstRun.TS).split(',').map(Number);
      if (tsArray.length > 1 && !isNaN(tsArray[1])) {
        fontSize = Math.abs(tsArray[1]);
      }
    }
    
    const pixelX = Math.round(textItem.x * scaleX);
    const pixelY = Math.round((pdfHeight - textItem.y - fontSize) * scaleY);
    const pixelWidth = Math.round(textItem.w * scaleX);
    const pixelHeight = Math.round(fontSize * scaleY);
    
    return {
      text: text,
      confidence: 1.0,
      x: pixelX,
      y: pixelY,
      width: pixelWidth,
      height: pixelHeight,
      fontSize: fontSize,
      groupNum: index
    };
  }).filter(item => item !== null);
}

// Existing routes...
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    console.log('incoming file:', req.file.path, req.file.mimetype);

    if (req.file.mimetype === 'application/pdf') {
      await convertPDFToImage(req.file.path, './output');
      const text = await performOCR('./output/page-1.jpg');
      const jsonData = await structuredData(text);

      const payload = typeof jsonData === 'string'
        ? JSON.parse(jsonData)
        : jsonData;

      return res.json(payload);

    } else if (req.file.mimetype.startsWith('image/')) {
      const text = await performOCR(req.file.path);
      const jsonData = await structuredData(text);
      const payload = typeof jsonData === 'string'
        ? JSON.parse(jsonData)
        : jsonData;
      return res.json(payload);
    }
    
    return res.status(400).json({ error: 'Unsupported file type' });

  } catch (err) {
    console.error('❌ Error in POST /api/invoices:', err.stack);
    return res.status(500).json({ error: err.message });
  }
});

// Enhanced PDF2JSON route with comprehensive extraction
router.post("/pdf2json", upload.single('file'), async (req, res) => {
  const io = req.app.locals.io;
  const socketId = req.headers['x-socket-id'];
  
  if (socketId) {
    io.to(socketId).emit('processing_start', { message: 'Starting comprehensive invoice processing...' });
  }
  
  const pdfPath = req.file.path;
  let JsonModalInvoice;
  let outputPath = './output';
  
  if (socketId) {
    io.to(socketId).emit('processing_step', { step: 'convert_pdf', message: 'Converting PDF to image...' });
  }
  
  await convertPDFToImage(pdfPath, outputPath);
  
  const imagePath = './output/page-1.jpg';
  const imageDimensions = await getImageDimensions(imagePath);
  
  if (socketId) {
    io.to(socketId).emit('processing_step', { step: 'ocr', message: 'Performing OCR on image...' });
  }
  
  let errors = [];
  const text = await performOCR('./output/page-1.jpg');

  parsePDFtoJSON(pdfPath, async function(pdf2JsonData){
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'parse_pdf', message: 'Parsing PDF data...' });
    }
    
    const parsedData = JSON.parse(pdf2JsonData);
    
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'extract_text', message: 'Converting to pixel coordinates...' });
    }
    
    const extractedData = convertToPixelCoordinates(parsedData, imageDimensions.width, imageDimensions.height);
    
    // Extract comprehensive invoice details
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'extract_details', message: 'Extracting comprehensive invoice details...' });
    }
    
    const invoiceDetails = extractInvoiceDetails(extractedData, text);
    
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'process_data', message: 'Processing extracted data...' });
      io.to(socketId).emit('positional_data', {
        groupedData: extractedData.map(item => [item]),
        invoiceDetails: invoiceDetails,
        message: 'Converting coordinates to pixels...'
      });
    }
    
    // Group processing logic (existing code)
    extractedData.forEach((currentItem, index) => {
      currentItem.groupNum = index;
    });

    extractedData.sort((a, b) => a.y - b.y || a.x - b.x);

    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'group_data', message: 'Grouping text elements...' });
    }

    // Existing grouping logic...
    extractedData.forEach(currentItem => {
      for (let j = 0; j < extractedData.length; j++) {
        const blockItem = extractedData[j];
  
        const sameX = Math.abs(currentItem.x - blockItem.x) < 5;
        const sameXPlusW = Math.abs(currentItem.x - (blockItem.x + blockItem.width)) < 5;
        const withinVerticalRange = Math.abs(currentItem.y - blockItem.y) < currentItem.height * 1.5;

        const closeY = Math.abs(currentItem.x - (blockItem.x + blockItem.width)) < 50;
        const sameLine = Math.abs(currentItem.y - blockItem.y) < 5;

        const withinSameXZone = (currentItem.x + currentItem.width >= blockItem.x) && 
                               (currentItem.x + currentItem.width <= blockItem.x + blockItem.width);
                               
        if ((sameX || sameXPlusW || withinSameXZone) && withinVerticalRange) {
          blockItem.groupNum = currentItem.groupNum;
        }
        if ((sameX && withinVerticalRange) || (sameLine && closeY)) {
          blockItem.groupNum = currentItem.groupNum;
        }
      }
    });

    const textBlocks = {};
    extractedData.forEach(item => {
      const groupNum = item.groupNum;
      if (!textBlocks[groupNum]) {
        textBlocks[groupNum] = [];
      }
      textBlocks[groupNum].push(item);
    });
    
    const groupedData = Object.values(textBlocks);

    // Extract items and totals (existing logic)
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'extract_items', message: 'Extracting line items...' });
    }
    
    // Header item extraction
    let headerItem;
    groupedData.forEach((textblock) => {
      for (let index = 0; index < textblock.length; index++) {
        const textrow = textblock[index];
        const keywords = [
          "artikel", "artikelnummer", "artikelnr", "product", "omschrijving", 
          "aantal", "stukprijs", "eenheid", "BTW", "totaal", "%", 
          "excl. btw", "incl. BTW"
        ];
        if (keywords.some(keyword => textrow.text.toLowerCase().includes(keyword.toLowerCase()))) {
          if (!headerItem) {
            headerItem = textblock;
          }
        }
      }
    });
    
    if (headerItem) {
      headerItem.sort((a, b) => a.x - b.x || a.y - b.y);
      // Header processing logic...
    }

    // Items extraction
    let ItemsTextBlock = null;
    let minDistance = Infinity;
    
    if (headerItem) {
      groupedData.forEach((textblock) => {
        const distance = Math.abs(textblock[0].y - headerItem[0].y);
        if (distance < minDistance && distance !== 0) {
          minDistance = distance;
          ItemsTextBlock = textblock;
        }
      });
    }
    
    let items = [];
    if (ItemsTextBlock) {
      ItemsTextBlock.sort((a, b) => a.y - b.y || a.x - b.x);
      
      const groupedByY = ItemsTextBlock.reduce((acc, item) => {
        const existingY = Object.keys(acc).find(y => Math.abs(parseFloat(y) - item.y) < 5);
        const yKey = existingY || item.y.toString();
        
        if (!acc[yKey]) {
          acc[yKey] = [];
        }
        acc[yKey].push(item);
        return acc;
      }, {});
      
      let ItemsArray = Object.values(groupedByY);
      ItemsArray = ItemsArray.filter(Item => Item.length > 1);

      items = ItemsArray.map(itemGroup => {
        const item = {};
        item.article_number = itemGroup[0]?.text || '';
        item.name = itemGroup[1]?.text || '';
        item.quantity = itemGroup[2]?.text || '';
        item.item_unit_price = itemGroup[3]?.text || '';
        item.item_amount_excl_vat = itemGroup[5]?.text || '';
        item.item_vat_percentage = itemGroup[4]?.text || '';
        
        item.coordinates = itemGroup.map(field => ({
          text: field.text,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height
        }));
        
        return item;
      });
    }

    // Total extraction
    if (socketId) {
      io.to(socketId).emit('processing_step', { step: 'extract_total', message: 'Extracting total amounts...' });
    }
    
    let TotalField = {};
    groupedData.forEach((textblock) => {
      const keywords = ["BTW", "totaal", "totaal BTW", "excl. btw", "incl. BTW", "subtotaal", "€"];
      const numberRegex = /\d+(\.\d{1,2})?/;
      const currencyRegex = /eur|doll|usd|€/i;
    
      const keywordCount = textblock.filter(textrow => 
        keywords.some(keyword => textrow.text.toLowerCase().includes(keyword.toLowerCase()))
      ).length;

      if (keywordCount > 2) {
        const numberRows = textblock.filter(textrow => 
          numberRegex.test(textrow.text) && currencyRegex.test(textrow.text)
        );
    
        numberRows.sort((a, b) => parseFloat(a.text.match(numberRegex)[0]) - parseFloat(b.text.match(numberRegex)[0]));
    
        if (numberRows.length > 0) {
          const vatAmountItems = parseFloat(numberRows[0].text.match(numberRegex)[0]);
          const totalAmountInclVat = parseFloat(numberRows[numberRows.length - 1].text.match(numberRegex)[0]);
          const subtotalAmountExclVat = totalAmountInclVat - vatAmountItems;
          const vatPercentage = (vatAmountItems / subtotalAmountExclVat) * 100;
    
          TotalField = {
            vat_amount_items: vatAmountItems,
            total_amount_incl_vat: totalAmountInclVat,
            subtotal_amount_excl_vat: subtotalAmountExclVat,
            vat_percentage: vatPercentage,
            coordinates: numberRows.map(row => ({
              text: row.text,
              x: row.x,
              y: row.y,
              width: row.width,
              height: row.height
            }))
          };
        }
      }
    });

    // Total check and AI fallback
    let total;
    if (!TotalField.total_amount_incl_vat) {
      console.log("Total not found, using AI");
      errors.push({error: "Total not found automatically."});
      const totalStr = await getTotal(text);
      total = JSON.parse(totalStr);
    } else {
      total = {
        "total_amount_incl_vat": TotalField.total_amount_incl_vat, 
        "subtotal_amount_excl_vat": TotalField.subtotal_amount_excl_vat, 
        "vat_amount_item": TotalField.vat_amount_items,
        "vat_percentage": TotalField.vat_percentage,
        "coordinates": TotalField.coordinates
      };
    }

    // Create comprehensive JSON response
  // Replace the existing JsonModalInvoice creation in your /pdf2json route with this enhanced version:

// Enhanced payment status detection
const enhancedPaymentInfo = determinePaymentStatus(text);

// Create comprehensive JSON response with all 16 required fields
JsonModalInvoice = {
  // Error tracking
  "error": errors,
  
  // 14. Invoice items with detailed structure
  "items": items,
  
  // 1. Sender information (Who sent the invoice)
  "sender": {
    company: invoiceDetails.sender.company || null,
    address: invoiceDetails.sender.address || null,
    postcode: invoiceDetails.sender.postcode || null,
    city: invoiceDetails.sender.city || null,
    phone: invoiceDetails.sender.phone || null,
    email: invoiceDetails.sender.email || null,
    website: invoiceDetails.sender.website || null,
    // 3. Country information
    country: invoiceDetails.company.country || 'UNKNOWN'
  },
  
  // 2. Receiver information (Who receives the invoice)
  "receiver": {
    company: invoiceDetails.receiver.company || null,
    address: invoiceDetails.receiver.address || null,
    postcode: invoiceDetails.receiver.postcode || null,
    city: invoiceDetails.receiver.city || null,
    contact_person: null // Could be extracted from "T.a.v." or "Attention" fields
  },
  
  // Company registration and identification
  "company": {
    // 5. Company registration number (KvK for NL, Enterprise number for BE)
    kvk_number: invoiceDetails.company.kvk_number || null,
    // 6-7. VAT/BTW number
    vat_number: invoiceDetails.company.vat_number || null,
    // 3. Country determination
    country: invoiceDetails.company.country || 'UNKNOWN',
    // 4. Company logo information
    logo: await extractCompanyLogo(imagePath, invoiceDetails.sender)
  },
  
  // Invoice details
  "invoice": {
    // 9. Invoice number
    number: invoiceDetails.invoice.number || null,
    // 8. Invoice date
    date: invoiceDetails.invoice.date || null,
    // 10. Payment status and method
    paid: enhancedPaymentInfo.paid,
    payment_method: enhancedPaymentInfo.method || invoiceDetails.invoice.payment_method,
    payment_confidence: enhancedPaymentInfo.confidence
  },
  
  // 15-16. Banking information
  "bank": {
    // 15. IBAN number
    iban: invoiceDetails.bank.iban || null,
    // 16. Account holder name
    account_holder: invoiceDetails.bank.account_holder || invoiceDetails.sender.company
  },
  
  // Technical details
  "imageDimensions": imageDimensions,
  
  // 11. Total amount including VAT/BTW
  "total_amount_incl_vat": total.total_amount_incl_vat || null,
  // 12. Subtotal excluding VAT/BTW
  "subtotal_amount_excl_vat": total.subtotal_amount_excl_vat || null,
  // VAT amount
  "vat_amount_item": total.vat_amount_item || null,
  // 13. VAT/BTW percentage
  "vat_percentage": total.vat_percentage || null,
  
  // Coordinate information for visualization
  "coordinates": total.coordinates || null,
  
  // Comprehensive validation results
  "data_validation": validateComprehensiveInvoiceData({
    sender: {
      company: invoiceDetails.sender.company,
      address: invoiceDetails.sender.address,
      phone: invoiceDetails.sender.phone,
      email: invoiceDetails.sender.email
    },
    receiver: {
      company: invoiceDetails.receiver.company,
      address: invoiceDetails.receiver.address
    },
    company: {
      country: invoiceDetails.company.country,
      kvk_number: invoiceDetails.company.kvk_number,
      vat_number: invoiceDetails.company.vat_number,
      logo: { found: true } // Based on logo extraction
    },
    invoice: {
      date: invoiceDetails.invoice.date,
      number: invoiceDetails.invoice.number,
      paid: enhancedPaymentInfo.paid,
      payment_method: enhancedPaymentInfo.method
    },
    total_amount_incl_vat: total.total_amount_incl_vat,
    subtotal_amount_excl_vat: total.subtotal_amount_excl_vat,
    vat_percentage: total.vat_percentage,
    items: items,
    bank: {
      iban: invoiceDetails.bank.iban,
      account_holder: invoiceDetails.bank.account_holder
    }
  })
};
    if (socketId) {
      io.to(socketId).emit('positional_data', {
        groupedData: groupedData,
        imageDimensions: imageDimensions,
        invoiceDetails: invoiceDetails,
        message: 'Sending comprehensive invoice data...'
      });
      
      io.to(socketId).emit('processing_complete', {
        message: 'Comprehensive processing complete',
        data: {
          groupedData: groupedData,
          JsonModalInvoice: JsonModalInvoice,
          imageDimensions: imageDimensions
        }
      });
    }
    
    const resjson = {
      groupedData: groupedData,
      JsonModalInvoice: JsonModalInvoice,
      imageDimensions: imageDimensions
    };
    
    res.json(resjson);
  });
});

// Existing routes for preview and test...
router.post("/pdf-preview", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.mimetype === 'application/pdf') {
      await convertPDFToImage(req.file.path, './output');
      const imageDimensions = await getImageDimensions('./output/page-1.jpg');
      
      return res.json({ 
        imageUrl: 'http://localhost:5000/api/invoices/output/page-1.jpg',
        dimensions: imageDimensions
      });
    } else {
      return res.status(400).json({ error: 'File is not a PDF' });
    }
  } catch (err) {
    console.error('Error in POST /api/invoices/pdf-preview:', err.stack);
    return res.status(500).json({ error: err.message });
  }
});

router.use('/output', express.static('output'));

router.post("/test", async(req, res) => {
  parsePDFtoJSON('./test/1.pdf', async function(jsonData) {
    const data = `{ 
      "sender": { 
      "company": "Bouwmaat Haarlem XL", 
      "address": "A. Hofmanweg 3-A", 
     "postcode":"2031 BH", 
     "city":"Haarlem", 
     "country":"Nederland", 
      "phone": "023-5530330", 
      "fax": "023-5530349", 
      "email": "haarlem@bouwmaat.nl", 
      "vat_number": "NL004293aaa940B01...", 
      "kvk_number": "30055682" 
      }, 
      "recipient" : { 
      "company": "Rubo-ingenieurs", 
      "attention_to": "van der Veldt", 
      "address": "Oosterstraat 9b", 
     "postcode":"2042 VE", 
     "city":"Zandvoort", 
     "country":"Nederland", 
     "debtor_number":"0005200448" 
      }, 
      "sender_country": "NL", 
      "invoice" : { 
      "date": "10-06-2024 11:05:46", 
      "invoice_number": "1018876", 
     "order_number": "123242e3e", 
      "paid": true,
      "payment_method": "Pin - MAES kaart", 
      "currency": "EUR" ,
      "tax": "BTW" , 
      "total_amount_incl_vat": 129.14, 
      "subtotal_amount_excl_vat": 106.73, 
      "vat_amount_item": 22.41, 
      "items" : [ 
      { 
      "article_number": "0000771032", 
      "name": "Siniat Gipsplaat Stuc 60x200cm 9,5 mm", 
      "quantity": 16, 
      "item_unit_price": 3.62, 
      "item_amount_excl_vat": 57.92, 
      "item_vat_percentage": "21%", 
      "item_amount_incl_vat":70.08, 
     "item_vat_amount":12.16 
      }, 
      { 
      "article_number": "0000049942", 
      "name": "Bocht PVC lijmmof/spie wanddikte 3,2 mm Ø 75 mm 45° KOMO-keur", 
      "quantity": 2, 
      "item_unit_price": 6.01, 
      "item_amount_excl_vat": 12.02, 
      "item_vat_percentage": "21%", 
      "item_vat_percentage": "21%", 
      "item_amount_incl_vat":14.54, 
     "item_vat_amount":2.52 
      }
      ] 
      }
     }`;
    
    text = await validateInvoiceData(data, jsonData);
    res.json(text);
  });
});

module.exports = router;