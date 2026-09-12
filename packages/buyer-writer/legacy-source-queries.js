// Pure query builders extracted from the protected legacy workflow. No fetching.
// Callers must bind the exact destination, including the explicit Stanly override.
import { BuyerSourceError } from "./source-http.js";
import { canonicalBuyerSaleDate } from "./dates.js";
import { STANLY_SOURCE_URL } from './source-policy.js';
export function createLegacyBuyerSourceQueryBuilders(input) {
const d=structuredClone(input);
for(const key of ["date_range_start","date_range_end"]) {
  if(d[key]!==null&&d[key]!==undefined&&d[key]!==""&&canonicalBuyerSaleDate(d[key])!==d[key])throw new BuyerSourceError("SOURCE_POLICY_REJECTED");
}

const PAGE_SIZE=1000;
function capGenericUrl(url){
  try{
    const u=new URL(url);
    u.searchParams.set('f','json');
    u.searchParams.set('returnGeometry','false');
    u.searchParams.set('resultRecordCount','500');
    return u.toString();
  }catch{
    throw new BuyerSourceError("SOURCE_POLICY_REJECTED");
  }
}

function buildGuilfordUrl(source, offset){
  const base=(source.source_url||'').split('?')[0];
  const whereParts=['PKG_SALE_PRICE > 0'];
  if(d.date_range_start) whereParts.push("PKG_SALE_DATE >= DATE '"+d.date_range_start+" 00:00:00'");
  if(d.date_range_end) whereParts.push("PKG_SALE_DATE <= DATE '"+d.date_range_end+" 23:59:59'");
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('PIN,REID,PROPERTY_OWNER,PROP_OWNER1_FULLNAME,PROP_OWNER2_FULLNAME,OWNER_MAIL_1,OWNER_MAIL_2,OWNER_MAIL_CITY,OWNER_MAIL_STATE,OWNER_MAIL_ZIP,LOCATION_ADDR,PKG_SALE_PRICE,PKG_SALE_DATE,LAND_SALE_PRICE,LAND_SALE_DATE,DEED_BOOK,DEED_PAGE,YEAR_BUILT,LAND_CLASS'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('PKG_SALE_DATE DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}

function buildWakeUrl(source, offset){
  const base=(source.source_url||'').split('?')[0];
  const whereParts=["TOTSALPRICE > 0"];
  const propType=(d.property_type||'').toLowerCase();
  if(propType.includes('land')) whereParts.push("LAND_CLASS = 'VAC'");
  if(d.date_range_start) whereParts.push("SALE_DATE >= DATE '"+d.date_range_start+" 00:00:00'");
  if(d.date_range_end) whereParts.push("SALE_DATE <= DATE '"+d.date_range_end+" 23:59:59'");
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('PIN_NUM,REID,OWNER,ADDR1,ADDR2,SITE_ADDRESS,TOTSALPRICE,SALE_DATE,LAND_CLASS'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('SALE_DATE DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}

function toArcgisIntDate(value){
  if(!value)return null;
  const parts=String(value).split('-');
  if(parts.length!==3)return null;
  return parts.join('');
}

function isNcOneMapCounty(){
  return ['chowan','currituck','jackson','pamlico','randolph','rockingham','johnston','columbus','dare'].includes((d.county||'').toLowerCase());
}

function buildNcOneMapUrl(source, offset){
  const base=(source.source_url||'').split('?')[0];
  const county=(d.county||'').replace(/'/g, "''");
  const whereParts=["cntyname = '"+county+"'"];
  const propType=(d.property_type||'').toLowerCase();
  if(propType.includes('land')) whereParts.push("(struct = 'N' OR parusedesc = 'VACANT')");
  if(d.date_range_start) whereParts.push("saledate >= DATE '"+d.date_range_start+" 00:00:00'");
  if(d.date_range_end) whereParts.push("saledate <= DATE '"+d.date_range_end+" 23:59:59'");
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('ownname,ownname2,mailadd,munit,mcity,mstate,mzip,siteadd,scity,parno,altparno,saledate,saledatetx,sourceref,struct,structno,parusedesc,cntyname,parval,landval'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('saledate DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}

function buildStanlyUrl(source,offset){
  const base=STANLY_SOURCE_URL;
  const whereParts=['DateSold IS NOT NULL','SaleAmount > 0'];
  if(d.date_range_start)whereParts.push("DateSold >= DATE '"+d.date_range_start+" 00:00:00'");
  if(d.date_range_end)whereParts.push("DateSold <= DATE '"+d.date_range_end+" 23:59:59'");
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('PIN,Name1,Name2,Name3,DateSold,SaleAmount,DeedBook,DeedPage,TaxPayerAddr1,TaxPayerAddr2,TaxPayerCity,State,Zip,PhyStreetAddr,YearBuilt'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('DateSold DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}

function buildLincolnUrl(source, offset){
  const base=(source.source_url||'').split('?')[0];
  const whereParts=["AMSLAM > 0"];
  const propType=(d.property_type||'').toLowerCase();
  if(propType.includes('land')) whereParts.push("VACANT = 'YES'");
  const startInt=toArcgisIntDate(d.date_range_start);
  const endInt=toArcgisIntDate(d.date_range_end);
  if(startInt) whereParts.push("AMDTSL >= "+startInt);
  if(endInt) whereParts.push("AMDTSL <= "+endInt);
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('NAME1,NAME2,ADDRESS1,ADDRESS2,CITY,STATE,ZIP,PHYSICALADDR,AMSLAM,AMDTSL,DEEDBK,DEEDPG,PIN,VACANT'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('AMDTSL DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}

function buildStokesUrl(source, offset){
  const base=(source.source_url||'').split('?')[0];
  const whereParts=['DEED_DATE IS NOT NULL'];
  if(d.date_range_start) whereParts.push("DEED_DATE >= DATE '"+d.date_range_start+" 00:00:00'");
  if(d.date_range_end) whereParts.push("DEED_DATE <= DATE '"+d.date_range_end+" 23:59:59'");
  const query=[
    'where='+encodeURIComponent(whereParts.join(' AND ')),
    'outFields='+encodeURIComponent('PIN,PIN_12D,PARCEL_NUMBER,PROPERTY_OWNER_1,PROPERTY_OWNER_2,OWNER_MAIL_ADDR_1,OWNER_MAIL_ADDR_2,OWNER_MAIL_ADDR_3,OWNER_MAIL_ADDR_CITY,OWNER_MAIL_ADDR_STATE,OWNER_MAIL_ADDR_ZIP,PHYSICAL_ADDRESS,LAND_CLASS,DEEDED_ACREAGE,DEED_DATE,DEED_BOOK,DEED_PAGE,DEED_BKPG'),
    'returnGeometry=false',
    'orderByFields='+encodeURIComponent('DEED_DATE DESC'),
    'resultRecordCount='+PAGE_SIZE,
    'resultOffset='+offset,
    'f=json'
  ].join('&');
  return base+'?'+query;
}
return {capGenericUrl,buildGuilfordUrl,buildWakeUrl,toArcgisIntDate,isNcOneMapCounty,buildNcOneMapUrl,buildStanlyUrl,buildLincolnUrl,buildStokesUrl};
}
