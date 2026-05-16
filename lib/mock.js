// Mock data for the LeadSentra platform
export const mockStats = {
  totalContacts: 2847392,
  activeCompanies: 184736,
  activeCampaigns: 24,
  emailsSent: 48392,
  openRate: 23.4,
  clickRate: 4.7,
  revenue: 847392,
};

export const mockCompanies = [
  {
    id: 1,
    name: "Acme Corp",
    industry: "Technology",
    size: "500-1000",
    location: "San Francisco, CA",
    contacts: 47,
  },
  {
    id: 2,
    name: "Global Dynamics",
    industry: "Manufacturing",
    size: "1000+",
    location: "New York, NY",
    contacts: 89,
  },
  {
    id: 3,
    name: "TechStart Inc",
    industry: "Technology",
    size: "50-100",
    location: "Austin, TX",
    contacts: 23,
  },
  {
    id: 4,
    name: "MedTech Solutions",
    industry: "Healthcare",
    size: "200-500",
    location: "Boston, MA",
    contacts: 156,
  },
];

export const mockContacts = [
  {
    id: 1,
    name: "John Smith",
    email: "john@acme.com",
    title: "VP of Sales",
    company: "Acme Corp",
    phone: "+1 555-0123",
    lastContact: "2024-01-15",
  },
  {
    id: 2,
    name: "Sarah Johnson",
    email: "sarah@globaldynamics.com",
    title: "CEO",
    company: "Global Dynamics",
    phone: "+1 555-0456",
    lastContact: "2024-01-14",
  },
  {
    id: 3,
    name: "Mike Wilson",
    email: "mike@techstart.com",
    title: "CTO",
    company: "TechStart Inc",
    phone: "+1 555-0789",
    lastContact: "2024-01-13",
  },
];

export const mockCampaigns = [
  {
    id: 1,
    name: "Q1 Enterprise Outreach",
    status: "Active",
    sent: 2840,
    opened: 847,
    clicked: 156,
    replies: 23,
  },
  {
    id: 2,
    name: "Product Launch Campaign",
    status: "Active",
    sent: 1560,
    opened: 468,
    clicked: 89,
    replies: 12,
  },
  {
    id: 3,
    name: "Holiday Follow-up",
    status: "Paused",
    sent: 890,
    opened: 234,
    clicked: 45,
    replies: 8,
  },
];

export const mockPipelineData = {
  New: [
    {
      id: 1,
      title: "Acme Corp Discovery",
      value: 45000,
      contact: "John Smith",
    },
    {
      id: 2,
      title: "TechStart Consultation",
      value: 12000,
      contact: "Mike Wilson",
    },
  ],
  Qualified: [
    {
      id: 3,
      title: "Global Dynamics Enterprise",
      value: 125000,
      contact: "Sarah Johnson",
    },
    {
      id: 4,
      title: "MedTech Integration",
      value: 67000,
      contact: "Dr. Lisa Chen",
    },
  ],
  Demo: [
    {
      id: 5,
      title: "StartupXYZ Platform Demo",
      value: 25000,
      contact: "Alex Rivera",
    },
  ],
  Proposal: [
    {
      id: 6,
      title: "Enterprise Corp Deal",
      value: 180000,
      contact: "Robert Kim",
    },
  ],
  Won: [
    { id: 7, title: "FinTech Solutions", value: 95000, contact: "Emma Davis" },
  ],
  Lost: [
    {
      id: 8,
      title: "RetailCorp Project",
      value: 35000,
      contact: "Tom Anderson",
    },
  ],
};

export const mockChartData = [
  { name: "Mon", opens: 240, clicks: 45 },
  { name: "Tue", opens: 180, clicks: 32 },
  { name: "Wed", opens: 320, clicks: 67 },
  { name: "Thu", opens: 280, clicks: 58 },
  { name: "Fri", opens: 195, clicks: 41 },
  { name: "Sat", opens: 89, clicks: 15 },
  { name: "Sun", opens: 125, clicks: 22 },
];

export const mockActivities = [
  {
    id: 1,
    type: "email",
    description: 'Campaign "Q1 Enterprise" sent to 2,840 contacts',
    time: "2 minutes ago",
    user: "System",
  },
  {
    id: 2,
    type: "contact",
    description: "New contact added: Sarah Johnson (Global Dynamics)",
    time: "15 minutes ago",
    user: "John Doe",
  },
  {
    id: 3,
    type: "deal",
    description: 'Deal "Enterprise Corp" moved to Proposal stage',
    time: "1 hour ago",
    user: "Jane Smith",
  },
  {
    id: 4,
    type: "import",
    description: "Successfully imported 1,247 contacts from CSV",
    time: "2 hours ago",
    user: "System",
  },
];

export const mockIntegrations = [
  {
    name: "Salesforce",
    description: "Sync contacts and deals",
    status: "connected",
    logo: "salesforce",
  },
  {
    name: "HubSpot",
    description: "Marketing automation",
    status: "available",
    logo: "hubspot",
  },
  {
    name: "Slack",
    description: "Team notifications",
    status: "connected",
    logo: "slack",
  },
  {
    name: "Gmail",
    description: "Email integration",
    status: "available",
    logo: "gmail",
  },
  {
    name: "LinkedIn",
    description: "Social selling",
    status: "available",
    logo: "linkedin",
  },
  {
    name: "Zapier",
    description: "Workflow automation",
    status: "available",
    logo: "zapier",
  },
];
