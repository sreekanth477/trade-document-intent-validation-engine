'use strict';

/**
 * UCP 600 Article Reference Library
 * Uniform Customs and Practice for Documentary Credits, 2007 Revision
 * International Chamber of Commerce Publication No. 600
 *
 * Provides structured references to all 39 articles with emphasis on
 * the articles most relevant to automated document examination.
 */

// ---------------------------------------------------------------------------
// Article definitions
// ---------------------------------------------------------------------------
const UCP_RULES = {
  '1': {
    articleNumber: '1',
    title: 'Application of UCP',
    description: 'The Uniform Customs and Practice for Documentary Credits, 2007 Revision, ICC Publication No. 600 ("UCP") are rules that apply to any documentary credit ("credit") (including, to the extent to which they may be applicable, any standby letter of credit) when the text of the credit expressly indicates that it is subject to these rules.',
    applicableDocuments: ['lc'],
    fieldTypes: ['applicableRules'],
    keyRequirements: [
      'Credit must expressly state it is subject to UCP 600',
      'Rules bind all parties unless expressly modified or excluded',
    ],
  },
  '2': {
    articleNumber: '2',
    title: 'Definitions',
    description: 'For the purpose of these rules: Advising bank means the bank that advises the credit at the request of the issuing bank. Applicant means the party on whose request the credit is issued. Beneficiary means the party in whose favour a credit is issued. Complying presentation means a presentation that is in accordance with the terms and conditions of the credit, the applicable provisions of these rules and international standard banking practice.',
    applicableDocuments: ['lc'],
    fieldTypes: ['advisingBank', 'applicant', 'beneficiary', 'issuingBank', 'confirmingBank'],
    keyRequirements: [
      'Parties must be clearly identified',
      'Banking day excludes days when the bank at which presentation is to be made is regularly closed',
    ],
  },
  '3': {
    articleNumber: '3',
    title: 'Interpretations',
    description: 'For the purpose of these rules: Where applicable, words in the singular include the plural and in the plural include the singular. A credit is irrevocable even if there is no indication to that effect. A document may be signed by handwriting, facsimile signature, perforated signature, stamp, symbol or any other mechanical or electronic method of authentication.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['lcType', 'signatures'],
    keyRequirements: [
      'Credits are irrevocable by default',
      'Multiple signatures and authentication methods are acceptable',
    ],
  },
  '4': {
    articleNumber: '4',
    title: 'Credits v. Contracts',
    description: 'A credit by its nature is a separate transaction from the sale or other contract on which it may be based. Banks are in no way concerned with or bound by such contract, even if any reference whatsoever to it is included in the credit. Consequently, the undertaking of a bank to honour, to negotiate or to fulfil any other obligation under the credit is not subject to claims or defences by the applicant resulting from its relationships with the issuing bank or the beneficiary.',
    applicableDocuments: ['lc', 'invoice'],
    fieldTypes: ['contractReference', 'goodsDescription'],
    keyRequirements: [
      'Banks deal with documents only, not goods or services',
      'Underlying contract terms do not override LC terms',
    ],
  },
  '5': {
    articleNumber: '5',
    title: 'Documents v. Goods, Services or Performance',
    description: 'Banks deal with documents and not with goods, services or performance to which the documents may relate.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['goodsDescription', 'cargoDescription'],
    keyRequirements: [
      'Document compliance is based on face value only',
      'Banks are not responsible for verifying underlying goods',
    ],
  },
  '6': {
    articleNumber: '6',
    title: 'Availability, Expiry Date and Place for Presentation',
    description: 'A credit must state the bank with which it is available or whether it is available with any bank. A credit available with a nominated bank is also available with the issuing bank. A credit must state an expiry date for presentation. An expiry date stated for honour or negotiation will be deemed to be an expiry date for presentation.',
    applicableDocuments: ['lc'],
    fieldTypes: ['expiryDate', 'expiryPlace', 'availability'],
    keyRequirements: [
      'LC must state expiry date and place',
      'Presentation must be on or before expiry date',
    ],
  },
  '7': {
    articleNumber: '7',
    title: 'Issuing Bank Undertaking',
    description: 'Provided that the stipulated documents are presented to the nominated bank or to the issuing bank and that they constitute a complying presentation, the issuing bank must honour if the credit is available by sight payment, deferred payment, acceptance or negotiation.',
    applicableDocuments: ['lc'],
    fieldTypes: ['issuingBank', 'paymentTerms', 'availability'],
    keyRequirements: [
      'Issuing bank is bound to honour complying presentations',
      'Payment obligation is independent of applicant default',
    ],
  },
  '8': {
    articleNumber: '8',
    title: 'Confirming Bank Undertaking',
    description: 'Provided that the stipulated documents are presented to the confirming bank or to any other nominated bank and that they constitute a complying presentation, the confirming bank must honour or negotiate.',
    applicableDocuments: ['lc'],
    fieldTypes: ['confirmingBank'],
    keyRequirements: [
      'Confirming bank adds independent payment undertaking',
      'Confirming bank has same obligations as issuing bank',
    ],
  },
  '9': {
    articleNumber: '9',
    title: 'Advising of Credits and Amendments',
    description: 'A credit and any amendment may be advised to a beneficiary through an advising bank. An advising bank that is not a confirming bank advises the credit and any amendment without any undertaking to honour or negotiate.',
    applicableDocuments: ['lc'],
    fieldTypes: ['advisingBank'],
    keyRequirements: [
      'Advising bank must verify apparent authenticity',
      'Advising bank without confirmation has no payment obligation',
    ],
  },
  '10': {
    articleNumber: '10',
    title: 'Amendments',
    description: 'Except as otherwise provided by article 38, a credit can neither be amended nor cancelled without the agreement of the issuing bank, the confirming bank, if any, and the beneficiary.',
    applicableDocuments: ['lc'],
    fieldTypes: ['amendments'],
    keyRequirements: [
      'Amendments require consent of all parties',
      'Partial acceptance of amendments is not permitted',
    ],
  },
  '11': {
    articleNumber: '11',
    title: 'Teletransmitted and Pre-Advised Credits and Amendments',
    description: 'An authenticated teletransmission of a credit or amendment will be deemed to be the operative credit or amendment, and any subsequent mail confirmation shall be disregarded.',
    applicableDocuments: ['lc'],
    fieldTypes: ['transmissionMethod'],
    keyRequirements: [
      'SWIFT transmission is operative LC',
      'Mail confirmation does not supersede teletransmission',
    ],
  },
  '12': {
    articleNumber: '12',
    title: 'Nomination',
    description: 'Unless a nominated bank is the confirming bank, an authorization to honour or negotiate does not impose any obligation on that nominated bank to honour or negotiate, except when expressly agreed to by that nominated bank and so communicated to the beneficiary.',
    applicableDocuments: ['lc'],
    fieldTypes: ['nominatedBank'],
    keyRequirements: [
      'Nomination alone does not create payment obligation on nominated bank',
    ],
  },
  '13': {
    articleNumber: '13',
    title: 'Bank-to-Bank Reimbursement Arrangements',
    description: 'If a credit states that reimbursement is to be obtained by a nominated bank from a reimbursing bank, the credit must state if the reimbursement is subject to the ICC rules for bank-to-bank reimbursements in effect on the date of issuance of the credit.',
    applicableDocuments: ['lc'],
    fieldTypes: ['reimbursementBank'],
    keyRequirements: [
      'Reimbursement arrangements must be clearly specified',
    ],
  },
  '14(a)': {
    articleNumber: '14(a)',
    title: 'Standard of Examination - Complying Presentation',
    description: 'A nominated bank acting on its nomination, a confirming bank, if any, and the issuing bank must each examine a presentation to determine, on the basis of the documents alone, whether or not the documents appear on their face to constitute a complying presentation.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['all'],
    keyRequirements: [
      'Examination is based on documents alone - face value standard',
      'Five banking days maximum for examination',
      'Compliance determined on face of documents',
    ],
  },
  '14(b)': {
    articleNumber: '14(b)',
    title: 'Standard of Examination - Five Banking Days',
    description: 'A nominated bank acting on its nomination, a confirming bank, if any, and the issuing bank shall each have a maximum of five banking days following the day of presentation to determine if a presentation is complying.',
    applicableDocuments: ['lc'],
    fieldTypes: ['presentationDate', 'expiryDate'],
    keyRequirements: [
      'Maximum five banking days for examination',
      'Day of presentation is day zero',
    ],
  },
  '14(c)': {
    articleNumber: '14(c)',
    title: 'Standard of Examination - Document Consistency',
    description: 'A presentation including one or more original transport documents subject to articles 19, 20, 21, 22, 23, 24 or 25 must be made by or on behalf of the beneficiary not later than 21 calendar days after the date of shipment as described in these rules, but in any event not later than the expiry date of the credit.',
    applicableDocuments: ['bl', 'lc'],
    fieldTypes: ['presentationDate', 'onBoardDate', 'shipmentDate', 'expiryDate'],
    keyRequirements: [
      'Transport documents must be presented within 21 calendar days of shipment',
      'Presentation must not exceed LC expiry date',
    ],
  },
  '14(d)': {
    articleNumber: '14(d)',
    title: 'Standard of Examination - Data Consistency Between Documents',
    description: 'Data in a document, when read in context with the credit, the document itself and international standard banking practice, need not be identical to, but must not conflict with, data in that document, any other stipulated document, or the credit.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['goodsDescription', 'cargoDescription', 'amount', 'parties'],
    keyRequirements: [
      'Data must not conflict between documents and LC',
      'Non-identical but non-conflicting data is acceptable',
      'Context-sensitive interpretation applies',
    ],
  },
  '14(e)': {
    articleNumber: '14(e)',
    title: 'Standard of Examination - Description of Goods',
    description: 'In documents other than the commercial invoice, the description of the goods, services or performance, if stated, may be in general terms not conflicting with their description in the credit.',
    applicableDocuments: ['bl', 'insurance'],
    fieldTypes: ['goodsDescription', 'cargoDescription'],
    keyRequirements: [
      'Non-invoice documents may use general goods description',
      'General description must not conflict with LC description',
    ],
  },
  '14(f)': {
    articleNumber: '14(f)',
    title: 'Standard of Examination - Shipper and Consignee',
    description: 'If a credit requires presentation of a document other than a transport document, insurance document or commercial invoice, without stipulating by whom the document is to be issued or its data content, banks will accept the document as presented, if its content appears to fulfil the function of the required document and otherwise complies with article 14(d).',
    applicableDocuments: ['lc', 'bl'],
    fieldTypes: ['shipper', 'consignee', 'issuer'],
    keyRequirements: [
      'Document must fulfil its stated function',
      'Issuer need not be specified unless LC requires it',
    ],
  },
  '14(g)': {
    articleNumber: '14(g)',
    title: 'Standard of Examination - Issuance Date',
    description: 'A document presented but not required by the credit will be disregarded and may be returned to the presenter.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['documentDate', 'issuanceDate'],
    keyRequirements: [
      'Unrequired documents may be disregarded',
      'Documents must not post-date the presentation date',
    ],
  },
  '14(h)': {
    articleNumber: '14(h)',
    title: 'Standard of Examination - Shipping Marks',
    description: 'If an address and contact details of the applicant appear as part of any document, they need not be the same as those stated in the credit or any other stipulated document, but must be in the same country as the applicant\'s address mentioned in the credit.',
    applicableDocuments: ['invoice', 'bl'],
    fieldTypes: ['applicantAddress', 'applicantContact'],
    keyRequirements: [
      'Applicant address must be in same country as LC states',
      'Different address/contact details are acceptable if same country',
    ],
  },
  '14(i)': {
    articleNumber: '14(i)',
    title: 'Standard of Examination - Clean Documents',
    description: 'The shipper or sender of the goods shown on any document need not be the beneficiary of the credit.',
    applicableDocuments: ['bl', 'invoice'],
    fieldTypes: ['shipper', 'beneficiary'],
    keyRequirements: [
      'Shipper and beneficiary may be different parties',
    ],
  },
  '14(j)': {
    articleNumber: '14(j)',
    title: 'Standard of Examination - Corrections and Alterations',
    description: 'When the addresses of the beneficiary and the applicant appear in any stipulated document, they need not be the same as those stated in the credit or in any other stipulated document, but must be in the same country as the respective addresses mentioned in the credit. Contact details (telefax, telephone, email and the like) stated as part of the beneficiary\'s and the applicant\'s address will be disregarded. However, when the address and contact details of the applicant appear as part of the consignee or notify party details on a transport document subject to articles 19, 20, 21, 22, 23, 24 or 25, they must be as stated in the credit.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['beneficiaryAddress', 'applicantAddress', 'consignee', 'notifyParty'],
    keyRequirements: [
      'Addresses must be in same country as LC states',
      'Consignee/notify party contact must match LC exactly on transport documents',
    ],
  },
  '15': {
    articleNumber: '15',
    title: 'Complying Presentation',
    description: 'When an issuing bank determines that a presentation is complying, it must honour. When a confirming bank determines that a presentation is complying, it must honour or negotiate and forward the documents to the issuing bank.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['all'],
    keyRequirements: [
      'Honour is mandatory upon complying presentation',
      'Documents must be forwarded to issuing bank',
    ],
  },
  '16': {
    articleNumber: '16',
    title: 'Discrepant Documents, Waiver and Notice',
    description: 'When a nominated bank acting on its nomination, a confirming bank, if any, or the issuing bank determines that a presentation does not comply, it may refuse to honour or negotiate. When an issuing bank determines that a presentation does not comply, it may in its sole judgement approach the applicant for a waiver of the discrepancies.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['all'],
    keyRequirements: [
      'Refusal notice must be sent within five banking days',
      'Refusal notice must state all discrepancies',
      'Notice must indicate documents held pending instructions',
    ],
  },
  '17': {
    articleNumber: '17',
    title: 'Original Documents and Copies',
    description: 'At least one original of each document stipulated in the credit must be presented. A bank shall treat as an original any document bearing an apparently original signature, mark, stamp, or label of the issuer of the document, unless the document itself indicates that it is not an original.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['originalDocument', 'copies', 'signature'],
    keyRequirements: [
      'At least one original of each required document must be presented',
      'Original must bear apparently original signature or authentication',
      'Document stating "copy" is not an original',
    ],
  },
  '18': {
    articleNumber: '18',
    title: 'Commercial Invoice',
    description: 'A commercial invoice must appear to have been issued by the beneficiary (except as provided in article 38). Must be made out in the name of the applicant (except as provided in sub-article 38(g)). Must be made out in the same currency as the credit. Need not be signed.',
    applicableDocuments: ['invoice'],
    fieldTypes: ['invoiceNumber', 'invoiceDate', 'seller', 'buyer', 'currency', 'amount', 'goodsDescription'],
    keyRequirements: [
      'Invoice must be issued by beneficiary',
      'Invoice must name applicant as buyer',
      'Currency must match LC currency',
      'Invoice amount must not exceed LC amount',
      'Goods description must match LC description exactly',
    ],
  },
  '19': {
    articleNumber: '19',
    title: 'Transport Document Covering at Least Two Different Modes of Transport',
    description: 'A transport document covering at least two different modes of transport (multimodal or combined transport document), however named, must appear to indicate the name of the carrier and be signed by the carrier or a named agent for or on behalf of the carrier, or the master or a named agent for or on behalf of the master.',
    applicableDocuments: ['bl'],
    fieldTypes: ['carrier', 'signature', 'portOfLoading', 'portOfDischarge', 'onBoardDate'],
    keyRequirements: [
      'Must be signed by carrier, named agent, master, or named agent of master',
      'Must indicate place of taking in charge and place of final destination',
      'On-board notation required if document is not on-board BL',
    ],
  },
  '20': {
    articleNumber: '20',
    title: 'Bill of Lading',
    description: 'A bill of lading, however named, must appear to indicate the name of the carrier and be signed by the carrier or a named agent for or on behalf of the carrier, or the master or a named agent for or on behalf of the master. Indicate that the goods have been shipped on board a named vessel at the port of loading stated in the credit.',
    applicableDocuments: ['bl'],
    fieldTypes: ['carrier', 'signature', 'vesselName', 'portOfLoading', 'portOfDischarge', 'onBoardDate', 'blDate'],
    keyRequirements: [
      'Must name carrier and be properly signed',
      'Must show goods shipped on board named vessel',
      'Port of loading must match LC',
      'Port of discharge must match LC',
      'On-board date is the date of shipment',
      'Must show number of originals issued',
    ],
  },
  '21': {
    articleNumber: '21',
    title: 'Non-Negotiable Sea Waybill',
    description: 'A non-negotiable sea waybill, however named, must appear to indicate the name of the carrier and be signed by the carrier or a named agent for or on behalf of the carrier, or the master or a named agent for or on behalf of the master.',
    applicableDocuments: ['bl'],
    fieldTypes: ['carrier', 'signature', 'portOfLoading', 'portOfDischarge'],
    keyRequirements: [
      'Must be signed by carrier or named agent',
      'Must indicate goods received or shipped on board',
    ],
  },
  '22': {
    articleNumber: '22',
    title: 'Charter Party Bill of Lading',
    description: 'A bill of lading, however named, containing an indication that it is subject to a charter party (charter party bill of lading), must appear to be signed by the master or a named agent for or on behalf of the master, or the owner or a named agent for or on behalf of the owner, or the charterer or a named agent for or on behalf of the charterer.',
    applicableDocuments: ['bl'],
    fieldTypes: ['signature', 'charterParty', 'owner', 'master'],
    keyRequirements: [
      'Charter party BL must be signed by master, owner, or charterer',
    ],
  },
  '23': {
    articleNumber: '23',
    title: 'Air Transport Document',
    description: 'An air transport document, however named, must appear to indicate the name of the carrier and be signed by the carrier or a named agent for or on behalf of the carrier. Indicate that the goods have been accepted for carriage.',
    applicableDocuments: ['bl'],
    fieldTypes: ['carrier', 'signature', 'airportOfDeparture', 'airportOfDestination', 'flightDate'],
    keyRequirements: [
      'Must be signed by carrier or named agent',
      'Must indicate goods accepted for carriage',
      'Actual flight date is the date of shipment',
    ],
  },
  '24': {
    articleNumber: '24',
    title: 'Road, Rail or Inland Waterway Transport Documents',
    description: 'A road, rail or inland waterway transport document, however named, must appear to indicate the name of the carrier and be signed by the carrier or a named agent for or on behalf of the carrier.',
    applicableDocuments: ['bl'],
    fieldTypes: ['carrier', 'signature'],
    keyRequirements: [
      'Must be signed by carrier or named agent',
    ],
  },
  '25': {
    articleNumber: '25',
    title: 'Courier Receipt, Post Receipt or Certificate of Posting',
    description: 'A courier receipt, however named, evidencing receipt of goods for transport, must appear to indicate the name of the courier service and be stamped or signed by the named courier service at the place from which the credit states the goods are to be shipped.',
    applicableDocuments: ['bl'],
    fieldTypes: ['courier', 'stampOrSignature', 'placeOfReceipt'],
    keyRequirements: [
      'Must bear stamp or signature of named courier',
      'Must indicate place of shipping from LC',
    ],
  },
  '26': {
    articleNumber: '26',
    title: '"On Deck", "Shipper\'s Load and Count", "Said by Shipper to Contain" and Charges Additional to Freight',
    description: 'A transport document must not indicate that the goods are or will be loaded on deck. A clause on a transport document stating that the carrier reserves the right to load the goods on deck is acceptable. A transport document bearing a clause such as "shipper\'s load and count" and "said by shipper to contain" is acceptable.',
    applicableDocuments: ['bl'],
    fieldTypes: ['deckClause', 'freightTerms', 'shippersLoadCount'],
    keyRequirements: [
      'On-deck loading clauses are not acceptable unless LC expressly permits',
      '"Shipper\'s load and count" clauses are acceptable',
    ],
  },
  '27': {
    articleNumber: '27',
    title: 'Clean Transport Document',
    description: 'A bank will only accept a clean transport document. A clean transport document is one bearing no clause or notation expressly declaring a defective condition of the goods or their packaging. The word "clean" need not appear on a transport document, even if a credit has a requirement for that transport document to be "clean on board".',
    applicableDocuments: ['bl'],
    fieldTypes: ['cleanClause', 'cargoCondition'],
    keyRequirements: [
      'Transport document must be clean - no defective condition notations',
      'Word "clean" need not appear explicitly',
    ],
  },
  '28': {
    articleNumber: '28',
    title: 'Insurance Document and Coverage',
    description: 'An insurance document, such as an insurance policy, an insurance certificate or a declaration under an open cover, must appear to be issued and signed by an insurance company, an underwriter or their agents or their proxies. Any date of issuance of the insurance document must be no later than the date of shipment, unless it appears from the insurance document that the coverage is effective from a date not later than the date of shipment.',
    applicableDocuments: ['insurance'],
    fieldTypes: ['policyNumber', 'insuredParty', 'insuredValue', 'coverageType', 'perilsCovered', 'effectiveDate', 'expiryDate', 'currency', 'claimsPayableAt'],
    keyRequirements: [
      'Must be issued and signed by insurance company, underwriter, or agent',
      'Coverage must be effective no later than date of shipment',
      'Must be in same currency as LC',
      'Minimum coverage 110% of CIF value',
      'Claims must be payable in currency of credit',
      'Must cover all risks specified in LC',
      'Institute Cargo Clauses A, B, or C must match LC requirements',
    ],
  },
  '29': {
    articleNumber: '29',
    title: 'Extension of Expiry Date or Last Day for Presentation',
    description: 'If the expiry date of a credit or the last day for presentation falls on a day when the bank to which presentation is to be made is closed for reasons other than those referred to in article 36, the expiry date or the last day for presentation, as the case may be, will be extended to the first following banking day.',
    applicableDocuments: ['lc'],
    fieldTypes: ['expiryDate', 'presentationDate'],
    keyRequirements: [
      'Expiry extends to next banking day if it falls on a holiday',
    ],
  },
  '30': {
    articleNumber: '30',
    title: 'Tolerance in Credit Amount, Quantity and Unit Prices',
    description: 'The words "about" or "approximately" used in connection with the amount of the credit or the quantity or the unit price stated in the credit are to be construed as allowing a tolerance not to exceed 10% more or 10% less than the amount, the quantity or the unit price to which they refer.',
    applicableDocuments: ['lc', 'invoice'],
    fieldTypes: ['amount', 'quantity', 'unitPrice', 'tolerance'],
    keyRequirements: [
      '"About" or "approximately" allows ±10% tolerance',
      '5% tolerance allowed in quantity if not stated in units',
      'Tolerance does not apply if LC states exact quantity',
    ],
  },
  '31': {
    articleNumber: '31',
    title: 'Partial Drawings or Shipments',
    description: 'Partial drawings or shipments are allowed. A presentation consisting of more than one set of transport documents evidencing shipment on the same means of conveyance and for the same journey, provided they indicate the same destination, will not be regarded as covering a partial shipment.',
    applicableDocuments: ['lc', 'bl', 'invoice'],
    fieldTypes: ['partialShipments', 'drawingAmount'],
    keyRequirements: [
      'Partial shipments permitted unless LC prohibits',
      'Multiple BLs on same vessel for same voyage = one shipment',
    ],
  },
  '32': {
    articleNumber: '32',
    title: 'Instalment Drawings or Shipments',
    description: 'If a drawing or shipment by instalments within given periods is stipulated in the credit and any instalment is not drawn or shipped within the period allowed for that instalment, the credit ceases to be available for that and any subsequent instalment.',
    applicableDocuments: ['lc', 'bl'],
    fieldTypes: ['instalments', 'drawingSchedule'],
    keyRequirements: [
      'Missed instalment voids availability for remaining instalments',
    ],
  },
  '33': {
    articleNumber: '33',
    title: 'Hours of Presentation',
    description: 'A bank has no obligation to accept a presentation outside of its banking hours.',
    applicableDocuments: ['lc'],
    fieldTypes: ['presentationTime'],
    keyRequirements: [
      'Presentation must be within banking hours of receiving bank',
    ],
  },
  '34': {
    articleNumber: '34',
    title: 'Disclaimer on Effectiveness of Documents',
    description: 'A bank assumes no liability or responsibility for the form, sufficiency, accuracy, genuineness, falsification or legal effect of any document, or for the general or particular conditions stipulated in a document or superimposed thereon.',
    applicableDocuments: ['lc', 'invoice', 'bl', 'insurance'],
    fieldTypes: ['all'],
    keyRequirements: [
      'Banks are not liable for document genuineness',
      'Face-value examination standard applies',
    ],
  },
  '35': {
    articleNumber: '35',
    title: 'Disclaimer on Transmission and Translation',
    description: 'A bank assumes no liability or responsibility for the consequences arising out of delay, loss in transit, mutilation or other errors arising in the transmission of any messages or delivery of letters or documents.',
    applicableDocuments: ['lc'],
    fieldTypes: ['transmission'],
    keyRequirements: [
      'Banks not liable for transmission errors',
    ],
  },
  '36': {
    articleNumber: '36',
    title: 'Force Majeure',
    description: 'A bank assumes no liability or responsibility for the consequences arising out of the interruption of its business by Acts of God, riots, civil commotions, insurrections, wars, acts of terrorism, or by any strikes or lockouts or any other causes beyond its control.',
    applicableDocuments: ['lc'],
    fieldTypes: ['forceMajeure'],
    keyRequirements: [
      'Banks not liable for force majeure events',
      'Credits that expire during force majeure events are not automatically extended',
    ],
  },
  '37': {
    articleNumber: '37',
    title: 'Disclaimer for Acts of an Instructed Party',
    description: 'A bank utilizing the services of another bank for the purpose of giving effect to the instructions of the applicant does so for the account and at the risk of the applicant. An issuing bank or advising bank assumes no liability or responsibility should the instructions it transmits to another bank not be carried out, even if that other bank has taken the initiative in the choice of that other bank.',
    applicableDocuments: ['lc'],
    fieldTypes: ['correspondentBank', 'instructions'],
    keyRequirements: [
      'Instructed bank services at applicant\'s risk',
    ],
  },
  '38': {
    articleNumber: '38',
    title: 'Transferable Credits',
    description: 'A bank is under no obligation to transfer a credit except to the extent and in the manner expressly consented to by that bank. A transferable credit means a credit that specifically states it is "transferable". A transferable credit may be made available in whole or in part to another beneficiary ("second beneficiary") at the request of the first beneficiary.',
    applicableDocuments: ['lc'],
    fieldTypes: ['transferable', 'firstBeneficiary', 'secondBeneficiary'],
    keyRequirements: [
      'Credit must state "transferable" to permit transfer',
      'May be transferred to one or more second beneficiaries',
      'Transferring bank has no obligation to transfer',
    ],
  },
  '39': {
    articleNumber: '39',
    title: 'Assignment of Proceeds',
    description: 'The fact that a credit is not stated to be transferable shall not affect the right of the beneficiary to assign any proceeds to which it may be or may become entitled under the credit, in accordance with the provisions of applicable law.',
    applicableDocuments: ['lc'],
    fieldTypes: ['assignmentOfProceeds'],
    keyRequirements: [
      'Assignment of proceeds is separate from transfer',
      'Proceeds may be assigned even if LC is not transferable',
    ],
  },
};

// ---------------------------------------------------------------------------
// Field-to-article mapping index
// ---------------------------------------------------------------------------
// Maps (documentType, fieldName) -> primary UCP article
const FIELD_ARTICLE_MAP = {
  lc: {
    lcNumber:            '6',
    applicant:           '2',
    beneficiary:         '2',
    issuingBank:         '7',
    advisingBank:        '9',
    lcType:              '3',
    currency:            '18',
    amount:              '30',
    expiryDate:          '6',
    expiryPlace:         '6',
    shipmentPeriod:      '20',
    latestShipmentDate:  '20',
    portOfLoading:       '20',
    portOfDischarge:     '20',
    goodsDescription:    '18',
    incoterms:           '4',
    documentRequirements:'15',
    specialConditions:   '14(a)',
    partialShipments:    '31',
    transhipment:        '20',
  },
  invoice: {
    invoiceNumber:    '18',
    invoiceDate:      '14(g)',
    seller:           '18',
    buyer:            '18',
    goodsDescription: '18',
    quantity:         '30',
    unitPrice:        '30',
    totalValue:       '18',
    currency:         '18',
    incoterms:        '4',
    hsCodes:          '5',
    countryOfOrigin:  '5',
    paymentTerms:     '7',
  },
  bl: {
    blNumber:          '20',
    blDate:            '20',
    shipper:           '14(i)',
    consignee:         '14(j)',
    notifyParty:       '14(j)',
    portOfLoading:     '20',
    portOfDischarge:   '20',
    vesselName:        '20',
    voyageNumber:      '20',
    containerNumbers:  '20',
    cargoDescription:  '14(e)',
    grossWeight:       '20',
    freightTerms:      '26',
    onBoardDate:       '20',
    cleanClause:       '27',
  },
  insurance: {
    policyNumber:    '28',
    insuredParty:    '28',
    insuredValue:    '28',
    currency:        '28',
    coverageType:    '28',
    perilsCovered:   '28',
    exclusions:      '28',
    effectiveDate:   '28',
    expiryDate:      '28',
    portOfLoading:   '28',
    portOfDischarge: '28',
    claimsPayableAt: '28',
  },
};

// ---------------------------------------------------------------------------
// Related articles graph
// ---------------------------------------------------------------------------
const RELATED_ARTICLES = {
  '14(a)': ['14(b)', '14(c)', '14(d)', '14(e)', '14(f)', '14(g)', '14(h)', '14(i)', '14(j)', '15', '16'],
  '14(b)': ['14(a)', '6', '29'],
  '14(c)': ['14(a)', '20', '6'],
  '14(d)': ['14(a)', '18', '20', '28'],
  '14(e)': ['14(a)', '18', '20'],
  '14(f)': ['14(a)', '2'],
  '14(g)': ['14(a)', '17'],
  '14(h)': ['14(a)', '2'],
  '14(i)': ['14(a)', '38'],
  '14(j)': ['14(a)', '2'],
  '15': ['14(a)', '7', '8', '16'],
  '16': ['15', '14(a)'],
  '17': ['14(g)', '20', '18', '28'],
  '18': ['14(d)', '14(e)', '30'],
  '20': ['14(c)', '14(d)', '27', '31'],
  '28': ['14(d)', '18'],
  '30': ['18', '31'],
  '31': ['20', '30', '32'],
  '38': ['2', '14(i)'],
};

// ---------------------------------------------------------------------------
// Exported helper functions
// ---------------------------------------------------------------------------

/**
 * Get the primary UCP article for a given document type and field name.
 * @param {string} documentType - 'lc' | 'invoice' | 'bl' | 'insurance'
 * @param {string} fieldName    - camelCase field name
 * @returns {string|null} article number string, e.g. "14(d)", or null if unknown
 */
function getArticleForField(documentType, fieldName) {
  const docMap = FIELD_ARTICLE_MAP[documentType];
  if (!docMap) return null;
  return docMap[fieldName] || null;
}

/**
 * Get related UCP articles for a given article number.
 * @param {string} articleNumber - e.g. "14(a)"
 * @returns {string[]} array of related article numbers
 */
function getRelatedArticles(articleNumber) {
  return RELATED_ARTICLES[articleNumber] || [];
}

/**
 * Get full article definition.
 * @param {string} articleNumber
 * @returns {object|null}
 */
function getArticle(articleNumber) {
  return UCP_RULES[articleNumber] || null;
}

/**
 * Get all articles applicable to a document type.
 * @param {string} documentType
 * @returns {object[]}
 */
function getArticlesForDocumentType(documentType) {
  return Object.values(UCP_RULES).filter(article =>
    article.applicableDocuments.includes(documentType) ||
    article.applicableDocuments.includes('all')
  );
}

module.exports = {
  UCP_RULES,
  getArticleForField,
  getRelatedArticles,
  getArticle,
  getArticlesForDocumentType,
  FIELD_ARTICLE_MAP,
};
