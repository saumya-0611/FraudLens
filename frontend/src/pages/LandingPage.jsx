import { Link } from "react-router-dom";
import { Activity, ArrowRight, AudioLines, Database, ShieldCheck, Waves, Workflow } from "lucide-react";
import "./LandingPage.css";

const pipeline = [
  { icon: Activity, title: "Transaction source", text: "Transactions enter through the API." },
  { icon: Waves, title: "Kafka", text: "Events move through the transaction stream." },
  { icon: Workflow, title: "Spark streaming", text: "Streaming features are prepared for scoring." },
  { icon: AudioLines, title: "ML scoring", text: "The model scores fraud probability and anomalies." },
  { icon: ShieldCheck, title: "Risk classification", text: "Transactions are classified as legitimate, suspicious, or high risk." },
  { icon: ShieldCheck, title: "Decision and alert", text: "Lower-risk activity continues; high-risk cases are flagged for review." },
  { icon: Database, title: "Records and audit", text: "Results and review events are persisted." },
];

const capabilities = [
  ["Live transaction monitoring", "Follow transactions as they move through the processing pipeline."],
  ["Fraud probability scoring", "Review model scores alongside each transaction."],
  ["Anomaly detection", "Surface unusual behavior for analyst attention."],
  ["Risk classification", "Group outcomes as legitimate, suspicious, or high risk."],
  ["Alert management", "Review alerts and record a resolution."],
  ["Access and audit controls", "Role-based screens and recorded administrative events."],
];

const technologies = ["React", "Express", "Kafka", "Apache Spark", "PostgreSQL", "FastAPI", "Docker"];

function Brand() {
  return <Link className="landing-brand" to="/home" aria-label="FraudLens home">
    <span className="landing-brand-mark"><ShieldCheck size={22} /></span>
    <span>Fraud<span className="landing-brand-accent">Lens</span></span>
  </Link>;
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-nav-wrap">
        <nav className="landing-nav" aria-label="Main navigation">
          <Brand />
          <div className="landing-nav-links">
            <a href="#home">Home</a>
            <a href="#overview">Overview</a>
            <a href="#how-it-works">How it works</a>
            <a href="#technology">Technology</a>
          </div>
          <Link className="landing-login" to="/">Login <ArrowRight size={16} /></Link>
        </nav>
      </header>

      <section className="landing-hero landing-container" id="home">
        <div className="landing-hero-copy">
          <span className="landing-kicker"><i /> FRAUD MONITORING PLATFORM</span>
          <h1>Real-Time Financial <span>Fraud Detection.</span></h1>
          <p>FraudLens brings streaming data and machine learning together to score transactions, surface suspicious activity, and support timely human review.</p>
          <div className="landing-actions">
            <Link className="landing-primary" to="/">Get started <ArrowRight size={17} /></Link>
            <a className="landing-secondary" href="#how-it-works">Explore how it works</a>
          </div>
          <div className="landing-proof"><span><ShieldCheck size={16} /> Role-aware access</span><span><Activity size={16} /> Event-driven pipeline</span></div>
        </div>

        <div className="landing-visual" aria-label="Illustration of a transaction moving through fraud review" role="img">
          <div className="visual-topline"><span>TRANSACTION REVIEW</span><span className="visual-state"><i /> PIPELINE</span></div>
          <div className="visual-transaction"><div className="visual-transaction-icon"><Activity size={20} /></div><div><small>Incoming event</small><strong>Transaction signal</strong></div><span className="visual-arrow"><ArrowRight size={17} /></span></div>
          <div className="visual-flow"><span /><span /><span /></div>
          <div className="visual-result"><div><span className="visual-label">MODEL OUTPUT</span><strong>Risk classification</strong><small>Probability scoring · anomaly signal</small></div><span className="visual-risk">REVIEW</span></div>
          <div className="visual-divider" />
          <div className="visual-footer"><span><i className="visual-green" /> Reviewed by role</span><span><i className="visual-blue" /> Recorded to audit trail</span></div>
          <div className="visual-caption">Illustrative workflow · no live operational metrics</div>
        </div>
      </section>

      <section className="landing-overview" id="overview">
        <div className="landing-container landing-overview-grid">
          <div><span className="landing-kicker">THE CHALLENGE</span><h2>Fraud moves quickly.<br /><span>Detection should keep pace.</span></h2></div>
          <p>When transaction review depends on delayed or disconnected signals, suspicious activity can take longer to reach the people who need to investigate it. FraudLens is designed around a streaming workflow so teams can monitor activity, inspect risk signals, and manage alerts in one place.</p>
        </div>
      </section>

      <section className="landing-section landing-container" id="how-it-works">
        <div className="landing-section-heading"><span className="landing-kicker">FROM EVENT TO REVIEW</span><h2>How FraudLens works</h2><p>A connected path from transaction intake to traceable review.</p></div>
        <ol className="pipeline-list">
          {pipeline.map(({ icon: Icon, title, text }, index) => <li className="pipeline-step" key={title}>
            <span className="pipeline-index">0{index + 1}</span><span className="pipeline-icon"><Icon size={20} /></span><h3>{title}</h3><p>{text}</p>
            {index < pipeline.length - 1 && <span className="pipeline-connector" aria-hidden="true"><ArrowRight size={15} /></span>}
          </li>)}
        </ol>
      </section>

      <section className="landing-capabilities">
        <div className="landing-container">
          <div className="landing-section-heading"><span className="landing-kicker">BUILT FOR REVIEW</span><h2>Signals your team can act on</h2></div>
          <div className="capability-list">{capabilities.map(([title, text], index) => <article className="capability-item" key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
        </div>
      </section>

      <section className="landing-section landing-container landing-technology" id="technology">
        <div><span className="landing-kicker">IMPLEMENTED STACK</span><h2>Built on a streaming architecture</h2><p>FraudLens connects a web dashboard to backend services, event streaming, model inference, and persistent operational data.</p></div>
        <ul className="technology-list">{technologies.map(technology => <li key={technology}>{technology}</li>)}</ul>
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner"><div><Brand /><p>Real-time transaction monitoring and fraud review for financial operations.</p></div><div className="footer-links"><a href="#home">Home</a><a href="#overview">Overview</a><a href="#how-it-works">How it works</a><a href="#technology">Technology</a><Link to="/">Login</Link></div><small>FraudLens · Financial fraud monitoring platform</small></div>
      </footer>
    </main>
  );
}
