// County conversion derived from the verified pre-change workflow; ISO source
// dates are additionally canonicalized to PostgreSQL calendar-date semantics.
// This module contains no database/source requests, credentials or n8n globals.
// Callers must supply authenticated, server-bound source context and bounded rows.
import {canonicalBuyerSaleDate} from './dates.js';
function normalizeBuyerPrice(value) {
  const price=Number.parseFloat(value??0);
  if(!Number.isFinite(price))throw new Error('Buyer source price rejected');
  return price;
}
export function normalizeBuyerSales(d) {
  if (!d || !Array.isArray(d.raw_sales) || d.raw_sales.length > 50000) {
    throw new Error('Buyer source data rejected');
  }
  for(const row of d.raw_sales) {
    if(!row||typeof row!=='object'||Array.isArray(row)
      ||Object.values(row).some(value=>typeof value==='number'&&!Number.isFinite(value))) {
      throw new Error('Buyer source data rejected');
    }
  }
const defaultSourceType=(d.source_type||'').toLowerCase();
const epochToISO=ms=>ms?new Date(ms).toISOString().split('T')[0]:null;

const rawSales=(d.raw_sales||[]).map(r=>{
  const st=(r._source_type||defaultSourceType||'').toLowerCase();

  if((d.county||'').toLowerCase()==='stokes'){
    const sd=epochToISO(r.DEED_DATE);
    const mailing=[r.OWNER_MAIL_ADDR_1,r.OWNER_MAIL_ADDR_2,r.OWNER_MAIL_ADDR_3,r.OWNER_MAIL_ADDR_CITY,r.OWNER_MAIL_ADDR_STATE,r.OWNER_MAIL_ADDR_ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const landClass=(r.LAND_CLASS||'').toString().toUpperCase();
    const prop=(landClass.includes('VACANT')||landClass.includes('AGRIC')||landClass.includes('FARM')||landClass.includes('TIMBER')||landClass.includes('LAND'))?'land':'residential';
    return{buyer_name:((r.PROPERTY_OWNER_1||'')+(r.PROPERTY_OWNER_2?' '+r.PROPERTY_OWNER_2:'')).trim(),seller_name:'',property_address:(r.PHYSICAL_ADDRESS||'').toString().trim(),mailing_address:mailing,sale_price:0,sale_date:sd,property_type:prop,parcel_id:(r.PIN_12D||r.PIN||r.PARCEL_NUMBER||'').toString().trim(),deed_type:r.DEED_BKPG?(r.DEED_BKPG||'').toString().trim():(r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():''),lender_name:'UNKNOWN'};
  }


    if((d.county||'').toLowerCase()==='stanly'){
    const sd=epochToISO(r.DateSold);
    const m=[r.TaxPayerAddr1,r.TaxPayerAddr2,r.TaxPayerCity,r.State,r.Zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.YearBuilt||Number(r.YearBuilt)===0)?'land':'residential';
    const deed=r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')+(r.Name3?' '+r.Name3:'')).trim(),seller_name:'',property_address:(r.PhyStreetAddr||'').toString().trim(),mailing_address:m,sale_price:r.SaleAmount||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if(['chowan','currituck','jackson','pamlico','randolph','rockingham','johnston','columbus','dare'].includes((d.county||'').toLowerCase())){
    const sd=epochToISO(r.saledate);
    const m=[r.mailadd,r.munit,r.mcity,r.mstate,r.mzip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const deed=(r.sourceref||'').toString().trim();
    const prop=((r.struct||'').toUpperCase()==='N'||(r.parusedesc||'').toUpperCase().includes('VACANT'))?'land':'residential';
    return{buyer_name:((r.ownname||'')+(r.ownname2?' '+r.ownname2:'')).trim(),seller_name:'',property_address:(r.siteadd||'').trim(),mailing_address:m,sale_price:r.parval||r.landval||0,sale_date:sd,property_type:prop,parcel_id:(r.parno||r.altparno||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='brunswick'){
    const ds=(r.DeedDate||'').split('/');
    const sd=ds.length===3?ds[2]+'-'+ds[0].padStart(2,'0')+'-'+ds[1].padStart(2,'0'):null;
    const m=[r.Address1,r.Address2,r.Address3,r.City,r.State,r.ZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const pa=[r.HouseNumber,r.StreetDirection,r.StreetName,r.StreetType].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ');
    const prop=(!r.ActualYearBuilt||String(r.ActualYearBuilt)==='0')?'land':'residential';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')).trim(),seller_name:'',property_address:pa,mailing_address:m,sale_price:0,sale_date:sd,property_type:prop,parcel_id:(r.ParcelNumber||r.PIN||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').trim()+' Page '+(r.DeedPage||'').trim():'',lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='orange'){
    const sd=epochToISO(r.DATESOLD);
    const m=[r.ADDRESS1,r.ADDRESS2,r.CITY,r.STATE,r.ZIPCODE].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=((Number(r.BLDGVALUE||0)===0)||!r.BLDGCNT||!r.YEARBUILT)?'land':'residential';
    return{buyer_name:((r.OWNER1||'')+(r.OWNER2?' '+r.OWNER2:'')).trim(),seller_name:'',property_address:'',mailing_address:m,sale_price:r.VALUATION||r.LANDVALUE||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||'').toString().trim(),deed_type:(r.DEEDREF||'').toString().trim(),lender_name:'UNKNOWN'};
  }


  if((d.county||'').toLowerCase()==='sampson'){
    const sd=(r.DATE_RECOR||'').toString().substring(0,10)||null;
    const m=[r.CURRENT_AD,r.CURRENT_CI,r.CURRENT_ST,r.CURRENT_ZI].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const seg=(r.SEG_TYPE_D||'').toString().toUpperCase();
    const cls=(r.PARCEL_CLA||'').toString().toUpperCase();
    const prop=(!r.YEAR_BUILT||Number(r.YEAR_BUILT)===0||seg.includes('LOT')||seg.includes('WOODLAND')||seg.includes('CROPLAND')||cls==='AGRICULTURE')?'land':'residential';
    return{buyer_name:(r.CURRENT_OW||'').trim(),seller_name:'',property_address:(r.PARCEL_ADD||'').trim(),mailing_address:m,sale_price:r.SALE_PRICE||r.ASSESSED_V||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||'').toString().trim(),deed_type:(r.BK_PG||r.DEED||'').toString().trim(),lender_name:'UNKNOWN'};
  }


  if((d.county||'').toLowerCase()==='davie'){
    const sd=(r.saleyear&&r.salemonth)?String(r.saleyear)+'-'+String(r.salemonth).padStart(2,'0')+'-01':null;
    const m=[r.address1,r.address2,r.city,r.state,r.zipcode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.parcelbuildingvalue||Number(r.parcelbuildingvalue)===0)?'land':'residential';
    const deed=(r.deed_bk_pg||'').toString().trim();
    const pa=(r.legaldescription||'').toString().trim();
    return{buyer_name:((r.name1||'')+(r.name2?' '+r.name2:'')).trim(),seller_name:'',property_address:pa,mailing_address:m,sale_price:r.totalmarketvalue||r.totalassessedvalue||r.parcellandvalue||0,sale_date:sd,property_type:prop,parcel_id:(r.ncpin||r.countyid||r.accountnumber||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }


  if((d.county||'').toLowerCase()==='catawba'){
    const sd=(r.sale_date||'').toString().substring(0,10)||null;
    const m=[r.address,r.address2,r.city,r.state,r.zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.bldg_value||Number(r.bldg_value)===0||!r.yr_built||(r.class||'').toString().toUpperCase()==='NA')?'land':'residential';
    const deed=[r.deed_bk,r.deed_pg].map(s=>(s||'').toString().trim()).filter(Boolean).join('/');
    return{buyer_name:((r.owner||'')+(r.owner2?' '+r.owner2:'')).trim(),seller_name:'',property_address:(r.legal||'').toString().trim(),mailing_address:m,sale_price:r.sale_amount||r.total_value||r.land_value||0,sale_date:sd,property_type:prop,parcel_id:(r.pinc||r.lrk||r.taxaccount||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }


  if((d.county||'').toLowerCase()==='edgecombe'){
    const sd=epochToISO(r.deeddate);
    const m=[r.address,r.city,r.st,r.zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const desc=(r.propdescr||'').toString().toUpperCase();
    const prop=(!r.bldgval||Number(r.bldgval)===0||(r.pclass||'').toString()==='07'||desc.includes('LAND')||desc.includes('LOT'))?'land':'residential';
    return{buyer_name:(r.owner||'').trim(),seller_name:'',property_address:(r.location||'').toString().trim(),mailing_address:m,sale_price:r.salepr||r.netval||r.landval||0,sale_date:sd,property_type:prop,parcel_id:(r.pin||r.parcel||r.linkpin||r.account||'').toString().trim(),deed_type:(r.bk_pg||'').toString().trim(),lender_name:'UNKNOWN'};
  }



  if((d.county||'').toLowerCase()==='granville'){
    const sd=epochToISO(r.DeedDate);
    const m=[r.AddressLine1,r.AddressLine2,r.AddressLine3,r.City,r.State,r.Zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.BuildingValue||Number(r.BuildingValue)===0)?'land':'residential';
    return{buyer_name:((r.OwnerName1||'')+(r.OwnerName2?' '+r.OwnerName2:'')).trim(),seller_name:'',property_address:(r.FormattedPropertyAddress||r.LegalDescription||'').toString().trim(),mailing_address:m,sale_price:r.SalePrice||r.MarketValue||r.AssessedValue||r.LandValue||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.Parcel||r.MAPN||r.PRODNO||r.RECN||'').toString().trim(),deed_type:(r.DeedBookPage||'').toString().trim(),lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='nash'){
    const sd=epochToISO(r.SALEDATE);
    const m=[r.MAIL_ADDR1,r.MAIL_ADDR2,r.ML_C_ST_Z].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.TOT_B_VAL||Number(r.TOT_B_VAL)===0)?'land':'residential';
    const deed=r.DEEDBOOK?'Book '+(r.DEEDBOOK||'').toString().trim()+' Page '+(r.DEEDPAGE||'').toString().trim():'';
    return{buyer_name:((r.OWNER1||'')+(r.OWNER2?' '+r.OWNER2:'')).trim(),seller_name:'',property_address:(r.PHYS_ADDR||r.DESCRIPLOC||'').toString().trim(),mailing_address:m,sale_price:r.SALEPRICE||r.APR_VAL||r.LANDVALUE||0,sale_date:sd,property_type:prop,parcel_id:(r.GIS_PIN||r.TAX_PIN||r.GIS_PARID||r.TAX_PARID||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='duplin'){
    const ds=(r.DeedDate||'').toString().split('/');
    const sd=ds.length===3?ds[2]+'-'+ds[0].padStart(2,'0')+'-'+ds[1].padStart(2,'0'):null;
    const m=[r.Address1,r.Address2,r.Address3,r.City,r.State,r.ZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.ActualYearBuilt||String(r.ActualYearBuilt)==='0')?'land':'residential';
    const deed=r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')).trim(),seller_name:'',property_address:(r.FormattedPropertyAddress||'').toString().trim(),mailing_address:m,sale_price:Number(r.SalePrice||0)||Number(r.TotalMarketValue||0)||Number(r.TotalAssessedValue||0)||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PinNumber||r.ParcelNumber||r.AccountNumber||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }



  if((d.county||'').toLowerCase()==='ashe'){
    const sd=(r.DeedDate||'').toString().substring(0,10)||null;
    const m=[r.Address1,r.Address2,r.Address3,r.City,r.State,r.ZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.ParcelBuil||Number(r.ParcelBuil)===0)?'land':'residential';
    const deed=r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'';
    return{buyer_name:(r.Name1||'').toString().trim(),seller_name:'',property_address:(r.ParcelProp||r.LegalDescr||'').toString().trim(),mailing_address:m,sale_price:r.SalePrice||r.TotalMarke||r.TotalAsses||r.ParcelLand||0,sale_date:sd,property_type:prop,parcel_id:(r.ParcelNumb||r.GPIN||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='avery'){
    const ds=String(r.DEED_DATE||'');
    const sd=ds.length===8?ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8):null;
    const m=[r.ADDR_1,r.ADDR_2,r.ADDR_3,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.BUILD_VALU||Number(r.BUILD_VALU)===0||!r.AYB||Number(r.AYB)===0)?'land':'residential';
    const deed=r.DEEDBOOK?'Book '+(r.DEEDBOOK||'').toString().trim()+' Page '+(r.DEEDPAGE||'').toString().trim():'';
    return{buyer_name:(r.OWNER_NAME||r.NAME_1||'').toString().trim(),seller_name:'',property_address:(r.ADDRESS||[r.LEGAL_1,r.LEGAL_2].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).toString().trim(),mailing_address:m,sale_price:r.SALEPRICE||r.TOTAL_VALU||r.LAND_VALU||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARNUM||r.ACCT_NO||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }



  if((d.county||'').toLowerCase()==='haywood'){
    const sd=epochToISO(r.Sale_Date);
    const m=[r.Addr_1,r.Addr_2,r.Addr_3,r.CSZ].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const desc=(r.Land_Desc||'').toString().toUpperCase();
    const prop=(!r.Bldg_Value||Number(r.Bldg_Value)===0||desc.includes('VAC')||desc.includes('LAND')||!r.Bldg_Use_Code)?'land':'residential';
    const deed=[r.LegalRef_1,r.LegalRef_2].map(s=>(s||'').toString().trim()).filter(Boolean).join(' / ');
    return{buyer_name:((r.Owner_1||'')+(r.Owner_2?' '+r.Owner_2:'')).toString().trim(),seller_name:'',property_address:(r.Prop_Addr||r.Prop_Desc||'').toString().trim(),mailing_address:m,sale_price:r.Sale_Price||r.Mkt_Value||r.Assd_Value||r.Land_Value||0,sale_date:sd,property_type:prop,parcel_id:(r.ALPHA||r.Acct_Nbr||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='burke'){
    const sd=epochToISO(r.PKG_SALE_DATE||r.DEED_DATE||r.LAND_SALE_DATE);
    const m=[r.OWNER_MAIL_1,r.OWNER_MAIL_2,r.OWNER_MAIL_3,r.OWNER_MAIL_CITY,r.OWNER_MAIL_STATE,r.OWNER_MAIL_ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const cls=(r.LAND_CLASS||'').toString().toUpperCase();
    const prop=(!r.TOTAL_BLDG_VALUE_ASSESSED||Number(r.TOTAL_BLDG_VALUE_ASSESSED)===0||cls.includes('VAC')||cls.includes('LAND'))?'land':'residential';
    const deed=r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():'';
    return{buyer_name:(r.PROPERTY_OWNER||'').toString().trim(),seller_name:'',property_address:(r.LOCATION_ADDR||'').toString().trim(),mailing_address:m,sale_price:r.PKG_SALE_PRICE||r.LAND_SALE_PRICE||r.TOTAL_LAND_VALUE_ASSESSED||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARCEL_PK||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='wilkes'){
    const sd=typeof r.SALEDATE==='number'?epochToISO(r.SALEDATE):(r.SALEDATE||'').toString().substring(0,10)||null;
    const m=[r.MAILADD1,r.MAILADD2].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const lt=(r.LANDTYPE||'').toString().toUpperCase();
    const prop=(!r.COSTBLDGVA||Number(r.COSTBLDGVA)===0||lt.includes('VAC')||lt.includes('LAND'))?'land':'residential';
    return{buyer_name:(r.OWNER1||'').toString().trim(),seller_name:'',property_address:'',mailing_address:m,sale_price:r.SALEPRICE||r.COSTLANDVA||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARCEL_ID||'').toString().trim(),deed_type:(r.BOOK_PAGE||r.SALE_VALIDITY||r.SALETYPE||'').toString().trim(),lender_name:'UNKNOWN'};
  }

  if((d.county||'').toLowerCase()==='beaufort'){
    const sd=epochToISO(r.date_dt);
    const m=[r.ADDR1,r.ADDR2,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.BLDG_VAL||Number(r.BLDG_VAL)===0||String(r.NBR_BLDG||'')==='0')?'land':'residential';
    const deed=(r.DB_PG||'').toString().trim()||(r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():'');
    return{buyer_name:((r.NAME1||'')+(r.NAME2?' '+r.NAME2:'')).trim(),seller_name:'',property_address:(r.PROP_ADDR||r.PROP_DESC||'').toString().trim(),mailing_address:m,sale_price:r.SALE_PRICE||r.TOT_VAL||r.LAND_VAL||0,sale_date:sd,property_type:prop,parcel_id:(r.GPIN||r.GPINLONG||r.PIN_1||r.REID||'').toString().trim(),deed_type:deed,lender_name:'UNKNOWN'};
  }

  // Robeson (ROKtech ROKMAPS_v2): OWNAM1/SALEAMT/DATESOLD(YYYYMMDD int)
  if(st==='arcgis'){
    const ds=String(r.DATESOLD||'');
    const sd=ds.length===8?ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8):null;
    const m=[r.OWCITY,r.OWSTATE,r.OWZIP].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.OWNAM1||'')+' '+(r.OWNAM2||'')).trim(),seller_name:'',property_address:(r.PHYSTRADR||'').trim(),mailing_address:m,sale_price:r.SALEAMT||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN_NUMBER||r.MAPNO||'').toString().trim(),deed_type:r.DEEDBOOK?'Book '+(r.DEEDBOOK||'').trim()+' Page '+(r.DEEDPAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Cumberland (gis.co.cumberland.nc.us): OWNER/PKG_SALE_PRICE/PKG_SALE_DATE(ISO string)
  if(st==='arcgis_cumberland'){
    const m=[r.ADDRESS,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:(r.OWNER||'').trim(),seller_name:'',property_address:(r.LOCATION_ADDR||'').trim(),mailing_address:m,sale_price:r.PKG_SALE_PRICE||r.LAND_SALE_PRICE||0,sale_date:r.PKG_SALE_DATE||r.LAND_SALE_DATE||null,property_type:'land',parcel_id:(r.NAD83_PIN||r.PIN||r.REID||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').trim()+' Page '+(r.DEED_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Hoke (maps.hokecounty.org): OWNER_NAME/COST_TOTAL/DEED_DATE(YYYYMMDD int)
  if(st==='arcgis_hoke'){
    const ds=String(r.DEED_DATE||'');
    const sd=ds.length===8?ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8):null;
    const m=[r.MAILING_AD||r.MAILING__1,r.CITY,r.STATE_OR_C,r.ZIP_CODE].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.OWNER_NAME||'')+(r.OWNER_NA_1?' '+r.OWNER_NA_1:'')).trim(),seller_name:'',property_address:(r.PHY_ADDRES||'').trim(),mailing_address:m,sale_price:r.COST_TOTAL||0,sale_date:sd,property_type:'land',parcel_id:(r.TWN_PIN||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').trim()+' Page '+(r.DEED_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Bladen (gis.bladenco.org): Name1/SalesAmoun/DeedYear(int??'YYYY-01-01)
  if(st==='arcgis_bladen'){
    const sd=r.DeedYear?String(r.DeedYear)+'-01-01':null;
    const m=[r.OwnerAddre,r.OwnerCity,r.OwnerState,r.OwnerZip].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')).trim(),seller_name:'',property_address:(r.PhysStreet||'').trim(),mailing_address:m,sale_price:r.SalesAmoun||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||r.PID||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').trim()+' Page '+(r.DeedPage||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Guilford / Durham (PKG epoch schema): PROPERTY_OWNER/PKG_SALE_PRICE/PKG_SALE_DATE(epoch ms)
  if(st==='arcgis_guilford'||st==='arcgis_durham'){
    const sd=epochToISO(r.PKG_SALE_DATE);
    const m=[r.OWNER_MAIL_1,r.OWNER_MAIL_CITY,r.OWNER_MAIL_STATE,r.OWNER_MAIL_ZIP].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:(r.PROPERTY_OWNER||'').split(';')[0].trim(),seller_name:'',property_address:(r.LOCATION_ADDR||'').trim(),mailing_address:m,sale_price:r.PKG_SALE_PRICE||r.LAND_SALE_PRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||r.REID||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').trim()+' Page '+(r.DEED_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Forsyth (maps.co.forsyth.nc.us): CURRENTOWNERNAME1+2/LASTQUALIFIEDSALEPRICE/CURRENTDEEDDATE(epoch ms)
  if(st==='arcgis_forsyth'){
    const sd=epochToISO(r.CURRENTDEEDDATE);
    const m=[(r.CURRENTOWNERADDRESS||'').trim(),(r.CURRENTOWNERCITYSTZIP||'').trim()].filter(Boolean).join(', ');
    const identityAudit='buyer_identity=current_owner_inferred; confidence=medium; reason=SalesApp transfer joined to NCPTS current owner by PIN';
    const deed=((r.CURRENTDEEDBKPG||'').toString().trim()||'No deed book/page')+' | '+identityAudit;
    return{buyer_name:((r.CURRENTOWNERNAME1||'')+(r.CURRENTOWNERNAME2?' '+r.CURRENTOWNERNAME2:'')).trim(),seller_name:'',property_address:(r.PROPERTYADDRESS||'').trim(),mailing_address:m,sale_price:r.LASTQUALIFIEDSALEPRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.TAXPIN||r.PIN||'').toString().trim(),deed_type:deed,lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Wake (maps.wakegov.com): OWNER/TOTSALPRICE/SALE_DATE(epoch ms)
  if(st==='arcgis_wake'){
    const sd=epochToISO(r.SALE_DATE);
    const m=[(r.ADDR1||'').trim(),(r.ADDR2||'').trim()].filter(Boolean).join(', ');
    return{buyer_name:(r.OWNER||'').trim(),seller_name:'',property_address:(r.SITE_ADDRESS||'').trim(),mailing_address:m,sale_price:r.TOTSALPRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN_NUM||r.REID||'').toString().trim(),deed_type:'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Rowan (gis.rowancountync.gov): OWNNAME/SALE_AMT/DATESOLD(epoch ms)
  if(st==='arcgis_rowan'){
    const sd=epochToISO(r.DATESOLD);
    const m=[r.TAXADD1,r.TAXADD2,r.CITY,r.STATE,r.ZIPCODE].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.OWNNAME||'')+(r.OWN2?' '+r.OWN2:'')).trim(),seller_name:'',property_address:(r.PROP_ADDRESS||'').trim(),mailing_address:m,sale_price:r.SALE_AMT||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||'').toString().trim(),deed_type:r.DEEDBOOK?'Book '+(r.DEEDBOOK||'').trim()+' Page '+(r.DEEDPAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Gaston (cogserver.gastonianc.gov): CURR_NAME1/SALESAMT/SALEDATE(epoch ms)
  if(st==='arcgis_gaston'){
    const sd=epochToISO(r.SALEDATE);
    const m=[r.CURR_ADDR1,r.CURR_CITY,r.CURR_STATE,r.CURR_ZIPCODE].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.CURR_NAME1||'')+(r.CURR_NAME2?' '+r.CURR_NAME2:'')).trim(),seller_name:'',property_address:(r.PHYSSTRADD||'').trim(),mailing_address:m,sale_price:r.SALESAMT||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').trim()+' Page '+(r.DEED_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Iredell (icgis.co.iredell.nc.us): Name/Sales_Price/Sale_Date(MM/DD/YYYY string)
  if(st==='arcgis_iredell'){
    const ds=(r.Sale_Date||'').split('/');
    const sd=ds.length===3?ds[2]+'-'+ds[0].padStart(2,'0')+'-'+ds[1].padStart(2,'0'):null;
    const m=[r.ADD1,r.ADD2,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    const pa=[(r.HouseNumber||'').toString(),(r.SDIR||''),(r.STREET||''),(r.STYPE||'')].map(s=>s.trim()).filter(Boolean).join(' ');
    return{buyer_name:(r.Name||'').trim(),seller_name:'',property_address:pa,mailing_address:m,sale_price:r.Sales_Price||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||'').toString().trim(),deed_type:r.DWBook?'Book '+(r.DWBook||'').trim()+' Page '+(r.DWPage||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  // Cabarrus (location.cabarruscounty.us): AcctName1/SalePrice/SaleYear+SaleMonth(YYYY-MM-01)
  if(st==='arcgis_cabarrus'){
    const sd=(r.SaleYear&&r.SaleMonth)?String(r.SaleYear)+'-'+String(r.SaleMonth).padStart(2,'0')+'-01':null;
    const m=[r.MailAddr1,r.MailAddr2,r.MailAddr3,r.MailCity,r.MailState,r.MailZipCode].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.AcctName1||'')+(r.AcctName2?' '+r.AcctName2:'')).trim(),seller_name:'',property_address:'',mailing_address:m,sale_price:r.SalePrice||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN14||r.PIN||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').trim()+' Page '+(r.DeedPage||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_onslow'){
    const monthMap={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
    const ds=(r.SALEDATE||'').split('-');
    const yr=ds.length===3?ds[2]:'00';
    const sd=ds.length===3?(parseInt(yr)>25?'19':'20')+yr+'-'+(monthMap[ds[1]]||'01')+'-'+ds[0].padStart(2,'0'):null;
    const m=[r.ADDRLINE1,r.ADDRLINE2,r.MAILCITY,r.MAILSTATE,r.MAILZIP].map(s=>(s||'').trim()).filter(Boolean).join(', ');
    return{buyer_name:((r.OWNER1||'')+(r.OWNER2?' '+r.OWNER2:'')).trim(),seller_name:'',property_address:(r.PHYSICALADDRESS||'').trim(),mailing_address:m,sale_price:r.SALEPRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||'').toString().trim(),deed_type:r.SALEBOOK?'Book '+(r.SALEBOOK||'').trim()+' Page '+(r.SALEPAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_buncombe'){
    const s=(r.DeedDate||'').toString();
    const sd=s.length===8?s.substring(0,4)+'-'+s.substring(4,6)+'-'+s.substring(6,8):null;
    const pa=[(r.HouseNumber||''),(r.streetname||''),(r.StreetType||'')].map(x=>x.trim()).filter(Boolean).join(' ');
    const m=[(r.Address||''),(r.CityName||''),(r.State||''),(r.Zipcode||'')].map(x=>x.trim()).filter(Boolean).join(', ');
    return{buyer_name:(r.owner||'').trim(),seller_name:'',property_address:pa,mailing_address:m,sale_price:r.SalePrice||0,sale_date:sd,property_type:'land',parcel_id:(r.pin||r.pinnum||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').trim()+' Page '+(r.DeedPage||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_newhanover'){
    const sd=(r.SALE_DATE||'').substring(0,10)||null;
    const m=[(r.OWNER_ADDR1||''),(r.OWNER_ADDR2||''),(r.OWNER_ADDR3||''),(r.OWNER_CITY||''),(r.OWNER_STATE||''),(r.OWNER_ZIP||'')].map(x=>x.trim()).filter(Boolean).join(', ');
    return{buyer_name:(r.OWN1||'').trim(),seller_name:'',property_address:'',mailing_address:m,sale_price:parseFloat(r.SALE_PRICE)||0,sale_date:sd,property_type:'land',parcel_id:(r.PARID||'').toString().trim(),deed_type:r.SALE_BOOK?'Book '+(r.SALE_BOOK||'').trim()+' Page '+(r.SALE_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_pender'){
    const sd=epochToISO(r.DATE);
    const m=[(r.ADDR||''),(r.CITY||''),(r.STATE||''),(r.ZIP||'')].map(x=>x.trim()).filter(Boolean).join(', ');
    return{buyer_name:(r.NAME||'').trim(),seller_name:'',property_address:(r.PROPERTY_ADDRESS||'').trim(),mailing_address:m,sale_price:r.SALE_PRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').trim()+' Page '+(r.DEED_PAGE||'').trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  if(st==='arcgis_alamance'){
    const ds=String(r.AMDTSL||'');
    const sd=ds.length===8?ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8):epochToISO(r.AMDTSL);
    const m=[r.OWADR1,r.OWADR2,r.OWADR3,r.OWADR4,r.OWCITY,r.OWSTA,r.OWZIPA].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.AKICFM||Number(r.AKICFM)===0||!r.AHCDBU)?'land':'residential';
    return{buyer_name:((r.OWNAM1||'')+(r.OWNAM2?' '+r.OWNAM2:'')+(r.OWNAM3?' '+r.OWNAM3:'')).trim(),seller_name:'',property_address:[r.AKPDIR,r.AKPSTN,r.AKPST_,r.AKPSTP].map(s=>(s||'').toString().trim()).filter(Boolean).join(' '),mailing_address:m,sale_price:r.AMSLAM||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.GPIN||r.PID||'').toString().trim(),deed_type:r.AMDBOK?'Book '+(r.AMDBOK||'').toString().trim()+' Page '+(r.AMDPGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_cherokee'){
    const sd=(r.SaleYear&&r.SaleMonth)?String(r.SaleYear)+'-'+String(r.SaleMonth).padStart(2,'0')+'-01':epochToISO(r.DeedDate||r.SaleDate);
    const m=[r.Address1,r.Address2,r.Address3,r.City,r.State,r.ZipCode,r.Zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=((r.VacantOrImproved||r.VacantOrIm||'').toString().toUpperCase().startsWith('V')||Number(r.ParcelBuildingValue||r.BuildingValue||0)===0)?'land':'residential';
    return{buyer_name:((r.Name1||r.Owner1||'')+(r.Name2||r.Owner2?' '+(r.Name2||r.Owner2):'')).trim(),seller_name:'',property_address:(r.PropertyAddress||r.PhysicalAddress||'').toString().trim(),mailing_address:m,sale_price:r.SalePrice||r.SalesPrice||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARCEL_ID||r.Parcel||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_craven'){
    const sd=epochToISO(r.SALE_DATE)||((r.PRECYR&&r.PRECMN&&r.PRECDY)?String(r.PRECYR)+'-'+String(r.PRECMN).padStart(2,'0')+'-'+String(r.PRECDY).padStart(2,'0'):null);
    const m=[r.TMADDR,r.CITYNM,r.TAXSTE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.totbld||Number(r.totbld)===0||(r.LUDESC||'').toString().toUpperCase().includes('FOREST')||(r.LUDESC||'').toString().toUpperCase().includes('AGRIC'))?'land':'residential';
    return{buyer_name:((r.BUYER1||r.PANAME||'')+(r.BUYER2?' '+r.BUYER2:'')).trim(),seller_name:((r.SELLER1||'')+(r.SELLER2?' '+r.SELLER2:'')).trim(),property_address:(r.FULLADD||[r.PASTNU,r.PASTDR,r.PASTNA,r.PASTAB].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:m,sale_price:r.SALE_PRICE||0,sale_date:sd,property_type:prop,parcel_id:(r.PID||'').toString().trim(),deed_type:r.PABOOK?'Book '+(r.PABOOK||'').toString().trim()+' Page '+(r.PAPAGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_davidson'){
    const sd=(r.SaleYear1&&r.SaleMonth1)?String(r.SaleYear1)+'-'+String(r.SaleMonth1).padStart(2,'0')+'-01':epochToISO(r.DeedDate);
    const m=[r.Address1,r.Address2,r.Address3,r.City,r.State,r.ZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=((r.VacantOrImproved1||'').toString().toUpperCase().startsWith('V')||Number(r.ParcelBuildingValue||0)===0)?'land':'residential';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')).trim(),seller_name:'',property_address:(r.PropertyAddress||[r.HouseNumber,r.StreetDirection,r.StreetName,r.StreetType,r.StreetSuffix].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:m,sale_price:r.SalePrice1||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PinNumber||r.PARCEL_ID||'').toString().trim(),deed_type:r.DeedBook1?'Book '+(r.DeedBook1||'').toString().trim()+' Page '+(r.DeedPage1||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_harnett'){
    const sd=(r.SaleYear&&r.SaleMonth)?String(r.SaleYear)+'-'+String(r.SaleMonth).padStart(2,'0')+'-01':epochToISO(r.DeedDate);
    const prop=((r.SaleVacantOrImproved||'').toString().toUpperCase().startsWith('V')||Number(r.ParcelBuildingValue||0)===0||!r.ActualYearBuilt)?'land':'residential';
    return{buyer_name:((r.Owner1||'')+(r.Owner2?' '+r.Owner2:'')||(r.Owners||'')).trim(),seller_name:'',property_address:(r.PhysicalAddress||'').toString().trim(),mailing_address:(r.MailingAddress||[r.OwnerAddress1,r.OwnerAddress2,r.OwnerAddress3,r.OwnerCity,r.OwnerState,r.OwnerZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ')).trim(),sale_price:r.SalePrice||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.ParcelID||r.REID||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_henderson'){
    const sd=epochToISO(r.PKG_SALE_DATE||r.LAND_SALE_DATE||r.DEED_DATE);
    const m=[r.OWNER_MAIL_1,r.OWNER_MAIL_2,r.OWNER_MAIL_3,r.OWNER_MAIL_CITY,r.OWNER_MAIL_STATE,r.OWNER_MAIL_ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.TOTAL_BLDG_VALUE_ASSESSED||Number(r.TOTAL_BLDG_VALUE_ASSESSED)===0||(r.LAND_CLASS||'').toString().toUpperCase().includes('VACANT'))?'land':'residential';
    return{buyer_name:(r.PROPERTY_OWNER||'').toString().trim(),seller_name:'',property_address:(r.LOCATION_ADDR||'').toString().trim(),mailing_address:m,sale_price:r.PKG_SALE_PRICE||r.LAND_SALE_PRICE||r.TOTAL_PROP_VALUE||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.REID||r.PARCEL_PK||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_lee'){
    const sd=epochToISO(r.SALEDT||r.Saledate);
    const m=[r.MailADRNO,r.MailADRDIR,r.MailADRSTR,r.MailADRSUF,r.MailCity,r.MailState,r.MailZip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.APRBLDG||Number(r.APRBLDG)===0||(r.UNITDESC||'').toString().toUpperCase().includes('LAND'))?'land':'residential';
    return{buyer_name:((r.OWN1||r.Owner1||'')+(r.OWN2||r.Owner2?' '+(r.OWN2||r.Owner2):'')).trim(),seller_name:'',property_address:(r.PropAddr||[r.ADRNO_1,r.ADRDIR_1,r.ADRSTR_1,r.ADRSUF_1].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:m,sale_price:r.PRICE||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARID||'').toString().trim(),deed_type:r.BOOK_1?'Book '+(r.BOOK_1||'').toString().trim()+' Page '+(r.PAGE_1||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_macon'){
    const sd=epochToISO(r.DATE_REC_1||r.SALE_DATE||r.DEED_DATE);
    return{buyer_name:(r.OWNER_NAME||r.NAME1||'').toString().trim(),seller_name:'',property_address:(r.PROP_ADDR||r.SITE_ADDR||'').toString().trim(),mailing_address:(r.OWNER_ADDR||r.MAILING_ADDRESS||'').toString().trim(),sale_price:r.SALES_PRIC||r.SALE_PRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||r.PARCEL_ID||'').toString().trim(),deed_type:(r.DEED_BK_PG||'').toString().trim(),lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_mecklenburg'){
    const sd=epochToISO(r.Sales_Date||r.SALE_DATE||r.DateSold)||((r.SalesYear&&r.SalesMonth)?String(r.SalesYear)+'-'+String(r.SalesMonth).padStart(2,'0')+'-01':null);
    const name=((r.Owner_FirstName||'')+' '+(r.Owner_LastName||'')).trim()||(r.OwnerName||r.OWNER_NAME||r.OWNER||'').toString().trim();
    return{buyer_name:name,seller_name:'',property_address:(r.Location||r.Situs_Address||r.PropertyAddress||'').toString().trim(),mailing_address:(r.MailingAddress||[r.MailAddr1,r.MailAddr2,r.MailCity,r.MailState,r.MailZip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ')).trim(),sale_price:r.Price||r.SalesPrice||r.SALE_PRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.Tax_ID||r.PID||r.PIN||r.ParcelID||'').toString().trim(),deed_type:(r.DeedBookPage||'').toString().trim(),lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_moore'){
    const sd=epochToISO(r.RECENT_SALEDT||r.TRANSDATE||r.VALID_SALESDT);
    const m=[r.ADDRESS,r.ADDRESS2,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.BUILD_VAL||Number(r.BUILD_VAL)===0||(r.LAND_STAT||'').toString().toUpperCase().includes('VACANT')||!r.YEARBUILT)?'land':'residential';
    return{buyer_name:((r.NAME||'')+(r.NAME2?' '+r.NAME2:'')).trim(),seller_name:'',property_address:[r.PROPNUM,r.PROPDIR,r.PROPST].map(s=>(s||'').toString().trim()).filter(Boolean).join(' '),mailing_address:m,sale_price:r.RECENT_SALE_PRICE||r.STAMP_VAL||r.TOTAL_VAL||r.LANDVALUE||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARID||r.LRK||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_person'){
    const ds=(r.Sale_Date||r.SALE_DATE||'').toString().split('/');
    const sd=ds.length===3?ds[2]+'-'+ds[0].padStart(2,'0')+'-'+ds[1].padStart(2,'0'):epochToISO(r.SaleDate);
    return{buyer_name:(r.Primary_Owner||r.OwnerName||r.NAME1||'').toString().trim(),seller_name:'',property_address:(r.Site_Address||r.PropertyAddress||'').toString().trim(),mailing_address:(r.MailingAddress||'').toString().trim(),sale_price:r.Sale_Price||r.SALE_PRICE||0,sale_date:sd,property_type:'land',parcel_id:(r.PIN||r.ParcelID||'').toString().trim(),deed_type:(r.DeedBookPage||'').toString().trim(),lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_pitt'){
    const parts=(r.SalesMonthYear||'').toString().split('/');
    const sd=parts.length===2?parts[1]+'-'+parts[0].padStart(2,'0')+'-01':epochToISO(r.DocumentDate);
    const prop=((r.VacOrImp||'').toString().toUpperCase().startsWith('V')||Number(r.CurBuildValue||0)===0||!r.YearBuilt)?'land':'residential';
    return{buyer_name:(r.OwnerName||'').toString().trim(),seller_name:'',property_address:(r.PhysicalAddress||[r.LocationNumber,r.LocationDirection,r.LocationStreet,r.LocationType].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:[r.OwnerAddress1,r.OwnerAddress2,r.OwnerAddress3,r.CityStateZip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', '),sale_price:r.SalesPrice||r.StampSalePrice||0,sale_date:sd,property_type:prop,parcel_id:(r.PinNum||r.NCPIN||r.REID||r.PARCELNUMBER||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_rutherford'){
    const sd=epochToISO(r.Deed_Date);
    const m=[r.Owner_Mailing_Address_1,r.Owner_Mailing_Address_2,r.Owner_Mailing_Address_3,r.Owner_Mailing_Address_City,r.Owner_Mailing_Address_State,r.Owner_Mailing_Address_Zip].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=(!r.Total_Building_Value_Assessed||Number(r.Total_Building_Value_Assessed)===0||(r.Land_Class||'').toString().toUpperCase().includes('VACANT'))?'land':'residential';
    return{buyer_name:(r.Property_Owner||'').toString().trim(),seller_name:'',property_address:(r.Physical_Address||[r.Physical_Address_Street_Number,r.Physical_Address_Dir_Prefix,r.Physical_Address_Street_Name,r.Physical_Address_Street_Type].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:m,sale_price:r.Sale_Price||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.Parcel_Number||'').toString().trim(),deed_type:r.Deed_Book?'Book '+(r.Deed_Book||'').toString().trim()+' Page '+(r.Deed_Page||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_surry'){
    const sd=(r.SaleYear&&r.SaleMonth)?String(r.SaleYear)+'-'+String(r.SaleMonth).padStart(2,'0')+'-01':null;
    const m=[r.Address1,r.Address2,r.City,r.State,r.ZipCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', ');
    const prop=((r.VacantOrImproved||'').toString().toUpperCase().startsWith('V')||Number(r.ParcelBuildingValue||0)===0)?'land':'residential';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')).trim(),seller_name:'',property_address:[r.HouseNumber,r.StreetDirection,r.StreetName,r.StreetType,r.StreetSuffix].map(s=>(s||'').toString().trim()).filter(Boolean).join(' '),mailing_address:m,sale_price:r.SalePrice||0,sale_date:sd,property_type:prop,parcel_id:(r.PARCEL_ID||r.Parcel||r.PIN4||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_warren'){
    const sd=epochToISO(r.DEEDDATE);
    const prop=(!r.BLDG_VAL||Number(r.BLDG_VAL)===0||(r.IMP_CODE||'').toString().toUpperCase()==='V')?'land':'residential';
    return{buyer_name:((r.NAME1||'')+(r.NAME2?' '+r.NAME2:'')).trim(),seller_name:'',property_address:(r.SITUS_ADDRESS||r.DESCRIPTION||'').toString().trim(),mailing_address:[r.ADDR,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', '),sale_price:r.SALE_PRICE||r.ASSESSED_VAL||r.LAND_VAL||0,sale_date:sd,property_type:prop,parcel_id:(r.NEWPIN||r.MAPN||r.RECN||'').toString().trim(),deed_type:r.DEEDBOOK?'Book '+(r.DEEDBOOK||'').toString().trim()+' Page '+(r.DEEDPAGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_wilson'){
    const ds=String(r.DateSold||'');
    const sd=ds.length===8?ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8):null;
    const prop=((r.Vacant_ImprovedCode||'').toString().toUpperCase()==='Y'||Number(r.ImproveASVCur||0)===0||!r.YearActuallyBuilt1Imp)?'land':'residential';
    return{buyer_name:((r.Name1||'')+(r.Name2?' '+r.Name2:'')+(r.Name3?' '+r.Name3:'')).trim(),seller_name:((r.GrantorName1||'')+(r.GrantorName2?' '+r.GrantorName2:'')).trim(),property_address:(r.PhysicalStreetAddress||[r.PhysLcStreetNumber,r.PhysLcStrDirection,r.PhysLcStreetName,r.PhysLcStrType].map(s=>(s||'').toString().trim()).filter(Boolean).join(' ')).trim(),mailing_address:[r.TaxpayerAddress1,r.TaxpayerAddress2,r.TaxpayerAddress3,r.TaxpayerCity,r.State,r.ZIPCode].map(s=>(s||'').toString().trim()).filter(Boolean).join(', '),sale_price:r.SalesAmount||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.GISPIN||r.ParcelNumber||'').toString().trim(),deed_type:r.DeedBook?'Book '+(r.DeedBook||'').toString().trim()+' Page '+(r.DeedPage||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }
  if(st==='arcgis_yadkin'){
    const sd=epochToISO(r.DEED_DATE);
    const prop=(!r.BLDG_FMV_CURRENT||Number(r.BLDG_FMV_CURRENT)===0||(r.DESCRIPTION||'').toString().toUpperCase().includes('VACANT')||!r.YEAR_BUILT)?'land':'residential';
    return{buyer_name:((r.NAME1||'')+(r.NAME2?' '+r.NAME2:'')).trim(),seller_name:'',property_address:(r.STREET_ADDRESS||'').toString().trim(),mailing_address:[r.ADDRESS1,r.ADDRESS2,r.CITY,r.STATE,r.ZIP].map(s=>(s||'').toString().trim()).filter(Boolean).join(', '),sale_price:r.SALES_AMT||r.LAND_FMV_CURRENT||0,sale_date:sd,property_type:prop,parcel_id:(r.PIN||r.PARCEL_NO||'').toString().trim(),deed_type:r.DEED_BOOK?'Book '+(r.DEED_BOOK||'').toString().trim()+' Page '+(r.DEED_PAGE||'').toString().trim():'',lender_name:d.no_cash_data?'UNKNOWN':''};
  }

  return r;
});

function get(obj,...keys){for(const k of keys){if(obj[k]!==undefined&&obj[k]!==null&&obj[k]!=='')return obj[k];}return null;}
const normalized=rawSales.map(r=>({search_job_id:d.search_job_id,buyer_name:(get(r,'buyer_name')||'').toString().trim().toUpperCase(),seller_name:(get(r,'seller_name')||'').toString().trim().toUpperCase(),property_address:(get(r,'property_address')||'').toString().trim().toUpperCase(),mailing_address:(get(r,'mailing_address')||null),county:d.county,state:d.state,sale_price:normalizeBuyerPrice(get(r,'sale_price')??0),sale_date:canonicalBuyerSaleDate(get(r,'sale_date')||null),property_type:(get(r,'property_type')||d.property_type||'land').toString().toLowerCase(),parcel_id:(get(r,'parcel_id')||'').toString(),deed_type:(get(r,'deed_type')||'').toString(),lender_name:(get(r,'lender_name')||'').toString().trim().toUpperCase()})).filter(r=>r.buyer_name);
const start=canonicalBuyerSaleDate(d.date_range_start);
const end=canonicalBuyerSaleDate(d.date_range_end);
if(start!==d.date_range_start||end!==d.date_range_end||start>end)throw new Error('Buyer source criteria rejected');
const filtered=normalized.filter(r=>r.sale_date!==null&&r.sale_date>=start&&r.sale_date<=end);
const propType=(d.property_type||'').toLowerCase();
const propFiltered=(!propType||propType==='all')?filtered:filtered.filter(r=>r.property_type.includes(propType));

  const project=({buyer_name,seller_name,property_address,mailing_address,sale_price,sale_date,property_type,parcel_id,deed_type,lender_name})=>({buyer_name,seller_name,property_address,mailing_address,sale_price,sale_date,property_type,parcel_id,deed_type,lender_name});
  return {raw:normalized.map(project),clean:propFiltered.map(project)};
}
