// CV text analysis — local only. Skills are detected against a fixed tech
// lexicon using whole-word matching, so the result only ever contains terms
// that are actually present in the CV text. Nothing is inferred or invented.

export interface CvSummary {
  skills: string[];
  projects: string[];
  roles: string[];
  rawLength: number;
}

// ~80 terms: languages, frameworks/libraries, tools, cloud/platforms, databases.
export const TECH_LEXICON: readonly string[] = [
  // languages
  'TypeScript', 'JavaScript', 'Python', 'Java', 'C#', 'C++', 'C', 'Go', 'Rust', 'PHP',
  'Ruby', 'Swift', 'Kotlin', 'Scala', 'SQL', 'HTML', 'CSS', 'Bash', 'PowerShell', 'R',
  // frameworks & libraries
  'Angular', 'React', 'Vue', 'Svelte', 'Next.js', 'Nuxt', 'Node.js', 'Express', 'NestJS',
  '.NET', 'ASP.NET', 'Spring', 'Django', 'Flask', 'FastAPI', 'Laravel', 'Rails', 'jQuery',
  'RxJS', 'NgRx', 'Redux', 'Tailwind CSS', 'Bootstrap', 'Entity Framework', 'Blazor',
  // tools & practices
  'Git', 'GitHub', 'GitLab', 'Docker', 'Kubernetes', 'Jenkins', 'CI/CD', 'Terraform',
  'Ansible', 'Linux', 'Nginx', 'Webpack', 'Vite', 'npm', 'Jest', 'Cypress', 'Playwright',
  'Selenium', 'JUnit', 'Postman', 'Figma', 'Jira', 'Agile', 'Scrum',
  // cloud & platforms
  'AWS', 'Azure', 'Google Cloud', 'Firebase', 'Heroku', 'Vercel', 'S3', 'EC2', 'Lambda',
  // databases & data
  'PostgreSQL', 'MySQL', 'SQL Server', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'Cassandra',
  'Elasticsearch', 'GraphQL', 'REST', 'Kafka', 'RabbitMQ', 'TensorFlow', 'PyTorch', 'Pandas',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeWordRegex(term: string): RegExp {
  // Whole-word: not preceded/followed by a letter, digit, or the characters
  // that are part of tech names (., #, +) so "C" doesn't match inside "CSS"
  // and ".NET" can match at a word start.
  return new RegExp(`(?<![A-Za-z0-9#+.])(?:${escapeRegExp(term)})(?![A-Za-z0-9#+])`, 'i');
}

/** Return lexicon terms actually present in the text (whole-word), using the CV's own casing when found. */
export function extractSkills(text: string): string[] {
  if (!text?.trim()) return [];
  const found: string[] = [];
  for (const term of TECH_LEXICON) {
    const m = text.match(wholeWordRegex(term));
    if (m) found.push(m[0]);
  }
  return found;
}

const SECTION_HEADERS =
  /^(experience|work experience|employment|education|skills|technical skills|summary|profile|projects|personal projects|key projects|certifications|contact|about)\b/i;

/** Heuristic: lines/bullets under a "Projects" heading, max 8. Falls back to "- " bullets mentioning a project-like title. */
export function extractProjects(text: string): string[] {
  if (!text?.trim()) return [];
  const lines = text.split(/\r?\n/);
  const projects: string[] = [];
  let inProjects = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^projects?\b/i.test(line)) {
      inProjects = true;
      // "Projects: Foo" inline form
      const inline = line.replace(/^projects?\s*[:\-–]\s*/i, '');
      if (inline && inline !== line) projects.push(inline);
      continue;
    }
    if (inProjects && SECTION_HEADERS.test(line) && !/^projects?\b/i.test(line)) break;
    if (inProjects) {
      const item = line.replace(/^[-•*]\s*/, '').trim();
      if (item && item.length >= 3) projects.push(item.replace(/\s{2,}.*$/, ''));
      if (projects.length >= 8) break;
    }
  }
  return [...new Set(projects)].slice(0, 8);
}

function extractRoles(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const roleWords =
    /\b(engineer|developer|designer|analyst|manager|consultant|administrator|architect|scientist|intern|lead|specialist)\b/i;
  const roles: string[] = [];
  // Title heuristic: the first few non-contact lines often carry the person's title(s).
  for (const line of lines.slice(0, 6)) {
    if (roleWords.test(line) && line.length <= 80 && !/@/.test(line)) {
      roles.push(line.replace(/[|•].*$/, '').trim());
    }
  }
  return [...new Set(roles)].slice(0, 3);
}

const NOT_A_NAME = /\b(resume|résumé|curriculum|vitae|cv|profile|summary|contact|email|phone|address|developer|engineer|manager|designer|analyst|intern|consultant|objective|experience|skills)\b/i;

/**
 * Best-effort candidate name: an explicit "Name: ..." line, otherwise the first
 * short line near the top made of 1-4 capitalised words (how most CVs start).
 * Returns '' when nothing looks like a name — the user can type it instead.
 */
export function extractName(text: string): string {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const labelled = lines.find((l) => /^(full\s+)?name\s*[:\-]/i.test(l));
  if (labelled) return labelled.replace(/^(full\s+)?name\s*[:\-]\s*/i, '').trim().slice(0, 60);
  for (const line of lines.slice(0, 6)) {
    const candidate = line.replace(/\s*[|•,].*$/, '').trim();
    const words = candidate.split(/\s+/);
    if (words.length > 4 || NOT_A_NAME.test(candidate)) continue;
    if (words.every((w) => /^[A-Z][a-zA-Z'.-]*$/.test(w))) {
      // "JAWAD KHAN" -> "Jawad Khan"
      return words.map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
    }
  }
  return '';
}

export function summarizeCv(text: string): CvSummary {
  const clean = text ?? '';
  return {
    skills: extractSkills(clean),
    projects: extractProjects(clean),
    roles: extractRoles(clean),
    rawLength: clean.length,
  };
}

/** Render a structured summary as the editable, confirmable summary text used for grounding. */
export function cvSummaryText(summary: CvSummary): string {
  const lines: string[] = [];
  if (summary.roles.length) lines.push(`Roles: ${summary.roles.join('; ')}`);
  if (summary.skills.length) lines.push(`Skills: ${summary.skills.join(', ')}`);
  if (summary.projects.length) {
    lines.push('Projects:');
    for (const p of summary.projects) lines.push(`- ${p}`);
  }
  return lines.join('\n');
}
