import { cvSummaryText, extractName, extractProjects, extractSkills, summarizeCv } from './cv';

const SAMPLE_CV = `Jawad Khan
Software Developer
Email: jawad@example.com

Skills
Angular, TypeScript, C#, .NET, ASP.NET, SQL Server, RxJS, Git, Docker, Azure

Experience
Built internal dashboards with Angular and .NET APIs.

Projects
- Shop Dashboard — Angular front end with .NET API and SQL Server
- Leave Tracker — ASP.NET Core app used by a small team
`;

describe('extractSkills', () => {
  it('returns only skills actually present in the CV', () => {
    const skills = extractSkills(SAMPLE_CV);
    expect(skills).toContain('Angular');
    expect(skills).toContain('.NET');
    expect(skills).toContain('TypeScript');
    expect(skills).toContain('SQL Server');
  });

  it('does NOT invent skills that are absent', () => {
    const skills = extractSkills(SAMPLE_CV);
    expect(skills).not.toContain('Kubernetes');
    expect(skills).not.toContain('React');
    expect(skills).not.toContain('AWS');
    expect(skills).not.toContain('Python');
  });

  it('whole-word matching: "C" alone does not appear from C#', () => {
    const skills = extractSkills('I know C# well.');
    expect(skills).toContain('C#');
    expect(skills).not.toContain('C');
  });

  it('handles empty text', () => {
    expect(extractSkills('')).toEqual([]);
    expect(extractSkills('   ')).toEqual([]);
  });
});

describe('extractProjects', () => {
  it('extracts project bullets', () => {
    const projects = extractProjects(SAMPLE_CV);
    expect(projects.length).toBe(2);
    expect(projects[0]).toContain('Shop Dashboard');
  });
});

describe('summarizeCv', () => {
  it('produces roles, skills, projects and raw length', () => {
    const s = summarizeCv(SAMPLE_CV);
    expect(s.rawLength).toBe(SAMPLE_CV.length);
    expect(s.roles.join(' ')).toContain('Developer');
    expect(s.skills).toContain('Angular');
    const text = cvSummaryText(s);
    expect(text).toContain('Skills:');
    expect(text).toContain('Angular');
    expect(text).not.toContain('Kubernetes');
  });
});

describe('extractName', () => {
  it('takes the first name-like line at the top of a CV', () => {
    expect(extractName(SAMPLE_CV)).toBe('Jawad Khan');
  });
  it('prefers an explicit Name: line and normalises ALL CAPS', () => {
    expect(extractName('CURRICULUM VITAE\nName: Sara Ahmed\nEmail: s@x.com')).toBe('Sara Ahmed');
    expect(extractName('JAWAD ALTAF\nSenior Developer')).toBe('Jawad Altaf');
  });
  it('returns empty when nothing looks like a name', () => {
    expect(extractName('Resume\nSoftware Engineer\nskills: angular')).toBe('');
  });
});
