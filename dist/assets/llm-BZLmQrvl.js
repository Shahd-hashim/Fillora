import{D as u,e as h}from"./storage-B6Jfe4U2.js";const f="https://openrouter.ai/api/v1/chat/completions";async function y(e,r){var a,l,c;if(!e.apiKey)throw new Error("Add your OpenRouter API key first.");const i=(e.models.length?e.models:u).slice(0,3),o=await fetch(f,{method:"POST",headers:{Authorization:`Bearer ${e.apiKey}`,"Content-Type":"application/json","X-Title":"Job Autofill AI"},body:JSON.stringify({models:i,messages:[{role:"user",content:r}],temperature:0})});if(!o.ok){const d=await o.text();throw new Error(`OpenRouter error ${o.status}: ${d.slice(0,300)}`)}const s=await o.json(),t=(c=(l=(a=s==null?void 0:s.choices)==null?void 0:a[0])==null?void 0:l.message)==null?void 0:c.content;if(!t)throw new Error("The model returned an empty answer. Try again or change the models.");return t}function w(e){const r=e.indexOf("{"),i=e.lastIndexOf("}");if(r<0||i<=r)throw new Error("The model did not return JSON. Try again.");return JSON.parse(e.slice(r,i+1))}const n=e=>typeof e=="string"?e.trim():e==null?"":String(e),p=e=>Array.isArray(e)?e:[],m=e=>Array.isArray(e)?e.map(n).filter(Boolean).join(", "):n(e),g=`{
  "fullName": "",
  "email": "",
  "phone": "",
  "location": "city, country",
  "linkedin": "",
  "github": "",
  "website": "",
  "summary": "2-3 sentence professional summary taken from the CV",
  "skills": ["..."],
  "languages": ["..."],
  "education": [{"school":"","degree":"","field":"","start":"","end":""}],
  "experience": [{"company":"","title":"","start":"","end":"","description":"main responsibilities and achievements"}]
}`;async function O(e,r){const i=`You extract structured data from a CV.
Return ONLY one JSON object that follows this shape, with no explanation and no markdown:
${g}

Rules:
- Use only information present in the CV. Use "" or [] when something is missing. Never invent values.
- Dates as written in the CV (for example "Jan 2022" or "Present").
- Keep experience in the order given in the CV.

CV TEXT:
"""
${r.slice(0,12e3)}
"""`,o=w(await y(e,i));return{...h(),fullName:n(o.fullName),email:n(o.email),phone:n(o.phone),location:n(o.location),linkedin:n(o.linkedin),github:n(o.github),website:n(o.website),summary:n(o.summary),skills:m(o.skills),languages:m(o.languages),education:p(o.education).map(t=>({school:n(t==null?void 0:t.school),degree:n(t==null?void 0:t.degree),field:n(t==null?void 0:t.field),start:n(t==null?void 0:t.start),end:n(t==null?void 0:t.end)})),experience:p(o.experience).map(t=>({company:n(t==null?void 0:t.company),title:n(t==null?void 0:t.title),start:n(t==null?void 0:t.start),end:n(t==null?void 0:t.end),description:n(t==null?void 0:t.description)})),rawCvText:r}}export{y as c,w as e,O as p};
