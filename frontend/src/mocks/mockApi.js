import usersData from "./users.json";
import auditData from "./audit-logs.json";
import modelsData from "./models.json";
import retrainingResults from "./retraining-results.json";
import summary from "./dashboard-summary.json";
import trends from "./dashboard-trends.json";
import transactionsData from "./transactions.json";
import alertsData from "./alerts.json";
import detail from "./transaction-details.json";
import pending from "./pending-transaction.json";
import { mockLogin, mockGetCurrentUser, mockLogout } from "./auth";

let users = [...usersData.items], alerts = [...alertsData.items];
let modelState = structuredClone(modelsData);
let retrainingRequestCount = 0;
const publicUser = user => Object.fromEntries(Object.entries(user).filter(([key])=>key!=="password"));
const failure=(code,message,status=400)=>{const e=new Error(message);e.status=status;e.data={error:{code,message,request_id:"mock-request-001"}};throw e;};
const bodyOf=options=>JSON.parse(options.body||"{}");

export async function mockRequest(path,options={}) {
 const method=(options.method||"GET").toUpperCase(), url=new URL(path,window.location.origin), pathname=url.pathname, q=url.searchParams;
 if(pathname==="/api/auth/login"&&method==="POST"){const b=bodyOf(options);return mockLogin(b.username,b.password);}
 if(pathname==="/api/auth/me"&&method==="GET")return mockGetCurrentUser();
 if(pathname==="/api/auth/logout"&&method==="POST")return mockLogout();
 if(pathname==="/api/dashboard/summary"&&method==="GET")return summary;
 if(pathname==="/api/dashboard/trends"&&method==="GET")return trends;
 if(pathname==="/api/users"&&method==="GET")return {items:users.map(publicUser)};
 if(pathname==="/api/users"&&method==="POST"){
  const b=bodyOf(options);if(!b.username||!b.password||!b.role)failure("VALIDATION_ERROR","Username, password and role are required.");
  if(!["ADMIN","ANALYST","VIEWER"].includes(b.role))failure("VALIDATION_ERROR","Invalid user role.");
  if(users.some(u=>u.username===b.username))failure("CONFLICT","Username already exists.",409);
  const user={id:Math.max(0,...users.map(u=>u.id))+1,username:b.username,role:b.role,status:"ACTIVE",created_at:new Date().toISOString(),password:b.password};users.push(user);return publicUser(user);
 }
 if(pathname.startsWith("/api/users/")&&method==="PATCH"){
  const id=Number(pathname.split("/").pop()), i=users.findIndex(u=>u.id===id);if(i<0)failure("NOT_FOUND","User was not found.",404);
  const b=bodyOf(options);if(b.role&&!['ADMIN','ANALYST','VIEWER'].includes(b.role))failure("VALIDATION_ERROR","Invalid user role.");if(b.status&&!['ACTIVE','DISABLED'].includes(b.status))failure("VALIDATION_ERROR","Invalid user status.");if(Object.keys(b).some(key=>!['role','status','password'].includes(key)))failure("VALIDATION_ERROR","An unsupported user field was provided.");if(b.role)users[i]={...users[i],role:b.role};if(b.status)users[i]={...users[i],status:b.status};if(Object.hasOwn(b,"password"))users[i]={...users[i],password:b.password};return publicUser(users[i]);
 }
 if(pathname==="/api/transactions"&&method==="GET"){
  let items=[...transactionsData.items,...([pending])];const risk=q.get("risk"), search=q.get("q")?.toLowerCase(), from=q.get("from"), to=q.get("to");
  if(risk)items=items.filter(x=>x.risk_category===risk);if(search)items=items.filter(x=>`${x.transaction_id} ${x.account_masked}`.toLowerCase().includes(search));if(from)items=items.filter(x=>new Date(x.tx_time)>=new Date(from));if(to)items=items.filter(x=>new Date(x.tx_time)<=new Date(to));
  const page=Number(q.get("page")||1), page_size=Number(q.get("page_size")||20), start=(page-1)*page_size;return {items:items.slice(start,start+page_size),page,page_size,total:items.length};
 }
 if(pathname.startsWith("/api/transactions/")&&method==="GET") {const id=decodeURIComponent(pathname.split("/").pop());if(id===detail.transaction_id)return detail;if(id===pending.transaction_id)return pending;failure("NOT_FOUND","Transaction was not found.",404);}
 if(pathname==="/api/alerts"&&method==="GET"){
  let items=[...alerts];const state=q.get("state");if(state)items=items.filter(a=>a.state===state);const page=Number(q.get("page")||1),page_size=Number(q.get("page_size")||20),start=(page-1)*page_size;return {items:items.slice(start,start+page_size),page,page_size,total:items.length};
 }
 if(pathname.startsWith("/api/alerts/")&&method==="PATCH"){
  const id=Number(pathname.split("/").pop()),i=alerts.findIndex(a=>a.alert_id===id);if(i<0)failure("NOT_FOUND","Alert was not found.",404);if(alerts[i].state==="RESOLVED")failure("CONFLICT","This alert has already been resolved.",409);
  const b=bodyOf(options);if(!["NEW","UNDER_REVIEW","RESOLVED"].includes(b.state))failure("VALIDATION_ERROR","The requested alert state is invalid.");const allowed=(alerts[i].state==="NEW"&&["UNDER_REVIEW","RESOLVED"].includes(b.state))||(alerts[i].state==="UNDER_REVIEW"&&b.state==="RESOLVED");if(!allowed)failure("CONFLICT","Invalid alert state transition.",409);if(b.state==="RESOLVED"&&!['CONFIRMED_FRAUD','FALSE_POSITIVE'].includes(b.resolution))failure("VALIDATION_ERROR","A resolution is required.");
  alerts[i]={...alerts[i],state:b.state,resolution:b.state==="RESOLVED"?b.resolution:null};return alerts[i];
 }
 if(pathname==="/api/audit-logs"&&method==="GET"){
  let items=[...auditData.items];if(q.get("action"))items=items.filter(x=>x.action===q.get("action"));if(q.get("username"))items=items.filter(x=>(x.username||"").toLowerCase().includes(q.get("username").toLowerCase()));const page=Number(q.get("page")||1),page_size=Number(q.get("page_size")||20),start=(page-1)*page_size;return {items:items.slice(start,start+page_size),page,page_size,total:items.length};
 }
 if(pathname==="/api/models"&&method==="GET")return modelState;
 if(pathname==="/api/models/drift-check"&&method==="POST"){modelState.latest_drift={id:2,created_at:new Date().toISOString(),model_version:modelState.active_version,psi_score:0.08,psi_features:{amount:0.04},status:"OK",sample_size:1000};return modelState.latest_drift;}
 if(pathname==="/api/models/retrain"&&method==="POST"){
  // Mock-only fixture sequence; this does not train or evaluate a real model.
  const fixture=retrainingResults[retrainingRequestCount++%retrainingResults.length];
  const result={version:`v${modelState.models.length+1}`,status:fixture.status,metrics:structuredClone(fixture.metrics)};
  modelState.models.push({version:result.version,algorithm:"xgboost+isolation_forest",metrics:result.metrics,status:result.status,artifact_path:"mock",sha256:"0".repeat(64),created_at:new Date().toISOString()});return result;
 }
 if(pathname.startsWith("/api/models/")&&pathname.endsWith("/activate")&&method==="POST"){const version=decodeURIComponent(pathname.split("/")[3]),model=modelState.models.find(m=>m.version===version);if(!model)failure("NOT_FOUND","Model was not found.",404);if(!["VALIDATED","ACTIVE","RETIRED"].includes(model.status))failure("CONFLICT","Model is not validated.",409);modelState.models.forEach(m=>{if(m.status==="ACTIVE")m.status="RETIRED";});model.status="ACTIVE";model.activated_at=new Date().toISOString();modelState.active_version=version;return {version,status:"ACTIVE"};}
 failure("NOT_FOUND",`No mock response for ${method} ${pathname}.`,404);
}
