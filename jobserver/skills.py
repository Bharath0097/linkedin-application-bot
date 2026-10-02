"""A dictionary of IT skills and job titles used to read resumes and job posts.

Each skill is a canonical name followed by the spellings that count as the same thing.
Matching is case-insensitive on whole words. Extend freely; order does not matter.
"""

SKILLS: dict[str, list[str]] = {
    # languages
    "Python": ["python"], "Java": ["java"], "JavaScript": ["javascript", "js", "es6"], "TypeScript": ["typescript"], "C#": ["c#", "csharp"],
    "C++": ["c++"], "C": ["c language"], "Go": ["golang", "go lang"], "Rust": ["rust"], "Ruby": ["ruby"], "PHP": ["php"], "Scala": ["scala"],
    "Kotlin": ["kotlin"], "Swift": ["swift"], "Objective-C": ["objective-c", "objective c"], "R": ["r language", "r programming"],
    "SQL": ["sql", "t-sql", "tsql", "pl/sql", "plsql"], "Shell scripting": ["shell scripting", "bash", "powershell", "unix shell"],
    "ABAP": ["abap"], "Apex": ["apex"], "COBOL": ["cobol"], "Perl": ["perl"], "MATLAB": ["matlab"], "SAS": ["sas"], "VBA": ["vba"],
    # web / front-end
    "React": ["react", "reactjs", "react.js"], "Angular": ["angular", "angularjs"], "Vue": ["vue", "vuejs", "vue.js"], "Next.js": ["next.js", "nextjs"],
    "Node.js": ["node", "nodejs", "node.js"], "Express": ["express.js", "expressjs"], "HTML": ["html", "html5"], "CSS": ["css", "css3", "sass", "scss"],
    "Redux": ["redux"], "jQuery": ["jquery"], "GraphQL": ["graphql"], "REST APIs": ["rest", "restful", "rest api", "rest apis", "web services"],
    "Microservices": ["microservices", "micro-services"], "Spring Boot": ["spring boot", "spring", "springboot"], "Hibernate": ["hibernate", "jpa"],
    ".NET": [".net", "dotnet", ".net core", "asp.net", "asp.net core"], "Django": ["django"], "Flask": ["flask"], "FastAPI": ["fastapi"],
    "Ruby on Rails": ["rails", "ruby on rails"], "Laravel": ["laravel"], "WordPress": ["wordpress"],
    # data
    "MySQL": ["mysql"], "PostgreSQL": ["postgresql", "postgres"], "Oracle": ["oracle", "oracle db", "oracle database"], "SQL Server": ["sql server", "mssql", "ms sql"],
    "MongoDB": ["mongodb", "mongo"], "Redis": ["redis"], "Cassandra": ["cassandra"], "DynamoDB": ["dynamodb"], "Elasticsearch": ["elasticsearch", "elastic search"],
    "Snowflake": ["snowflake"], "Databricks": ["databricks"], "Spark": ["spark", "pyspark", "apache spark"], "Hadoop": ["hadoop", "hdfs", "hive"],
    "Kafka": ["kafka"], "Airflow": ["airflow"], "ETL": ["etl", "elt"], "Data warehouse": ["data warehouse", "data warehousing", "dwh"],
    "Informatica": ["informatica"], "Talend": ["talend"], "SSIS": ["ssis"], "SSRS": ["ssrs"], "Tableau": ["tableau"], "Power BI": ["power bi", "powerbi"],
    "Looker": ["looker"], "Qlik": ["qlik", "qlikview", "qlik sense"], "dbt": ["dbt"], "Teradata": ["teradata"], "Redshift": ["redshift"], "BigQuery": ["bigquery"],
    "Data modeling": ["data modeling", "data modelling"], "Data engineering": ["data engineering", "data pipelines"],
    "Machine learning": ["machine learning", "ml"], "Deep learning": ["deep learning", "neural networks"], "NLP": ["nlp", "natural language processing"],
    "TensorFlow": ["tensorflow"], "PyTorch": ["pytorch"], "scikit-learn": ["scikit-learn", "sklearn"], "Pandas": ["pandas"], "NumPy": ["numpy"],
    "Generative AI": ["generative ai", "genai", "llm", "llms", "large language models"], "Computer vision": ["computer vision", "opencv"],
    # cloud / devops
    "AWS": ["aws", "amazon web services"], "Azure": ["azure", "microsoft azure"], "GCP": ["gcp", "google cloud"], "Docker": ["docker"],
    "Kubernetes": ["kubernetes", "k8s", "eks", "aks", "gke"], "Terraform": ["terraform"], "Ansible": ["ansible"], "Jenkins": ["jenkins"],
    "CI/CD": ["ci/cd", "cicd", "continuous integration", "continuous delivery"], "Git": ["git", "github", "gitlab", "bitbucket"],
    "Linux": ["linux", "rhel", "red hat", "ubuntu", "centos"], "Windows Server": ["windows server"], "VMware": ["vmware", "vsphere", "esxi"],
    "Helm": ["helm"], "Prometheus": ["prometheus"], "Grafana": ["grafana"], "Splunk": ["splunk"], "Datadog": ["datadog"], "Nagios": ["nagios"],
    "CloudFormation": ["cloudformation"], "Lambda": ["lambda", "aws lambda"], "S3": ["s3"], "EC2": ["ec2"], "OpenShift": ["openshift"],
    "DevOps": ["devops"], "SRE": ["sre", "site reliability"], "Azure DevOps": ["azure devops", "vsts", "tfs"], "Octopus Deploy": ["octopus"],
    # networking / security
    "Cisco": ["cisco", "ccna", "ccnp"], "Networking": ["networking", "tcp/ip", "lan/wan", "routing and switching", "network engineer"],
    "Firewalls": ["firewall", "firewalls", "palo alto", "fortinet", "checkpoint"], "VPN": ["vpn"], "Load balancers": ["f5", "load balancer", "load balancing"],
    "Cybersecurity": ["cybersecurity", "cyber security", "information security", "infosec"], "SIEM": ["siem", "qradar", "sentinel", "arcsight"],
    "Penetration testing": ["penetration testing", "pen testing", "pentest"], "IAM": ["iam", "identity and access management", "okta", "sailpoint", "cyberark"],
    "SOC": ["soc analyst", "security operations"], "Vulnerability management": ["vulnerability management", "nessus", "qualys", "tenable"],
    "Active Directory": ["active directory", "ad", "ldap"], "Office 365": ["office 365", "o365", "microsoft 365", "m365"], "Intune": ["intune", "sccm", "mecm"],
    "Zero trust": ["zero trust"], "CISSP": ["cissp"], "NIST": ["nist"], "SOX": ["sox"], "HIPAA": ["hipaa"], "PCI": ["pci", "pci-dss"],
    # ERP / CRM / enterprise
    "SAP": ["sap"], "SAP S/4HANA": ["s/4hana", "s4hana", "s/4 hana"], "SAP FICO": ["sap fico", "fico", "sap fi", "sap co"], "SAP MM": ["sap mm"],
    "SAP SD": ["sap sd"], "SAP PP": ["sap pp"], "SAP QM": ["sap qm"], "SAP HCM": ["sap hcm", "sap hr", "successfactors"], "SAP BW": ["sap bw", "bw/4hana"],
    "SAP Basis": ["sap basis"], "SAP ABAP": ["sap abap"], "SAP EWM": ["sap ewm", "sap wm"], "SAP PM": ["sap pm"], "SAP Ariba": ["ariba"], "SAP Fiori": ["fiori", "ui5", "sapui5"],
    "Oracle EBS": ["oracle ebs", "e-business suite", "oracle apps"], "Oracle Fusion": ["oracle fusion", "oracle cloud erp", "fusion cloud"],
    "PeopleSoft": ["peoplesoft"], "JD Edwards": ["jd edwards", "jde"], "Workday": ["workday"], "NetSuite": ["netsuite"], "Dynamics 365": ["dynamics 365", "dynamics crm", "dynamics ax", "d365"],
    "Salesforce": ["salesforce", "sfdc", "lightning", "lwc"], "ServiceNow": ["servicenow", "service now", "itsm"], "SharePoint": ["sharepoint"],
    "Power Platform": ["power platform", "power apps", "powerapps", "power automate"], "MuleSoft": ["mulesoft", "mule"], "Boomi": ["boomi", "dell boomi"],
    "Guidewire": ["guidewire"], "Pega": ["pega"], "Appian": ["appian"], "UiPath": ["uipath", "rpa", "automation anywhere", "blue prism"], "Infor": ["infor"],
    "Kronos": ["kronos", "ukg"], "ADP": ["adp"], "Coupa": ["coupa"], "Anaplan": ["anaplan"], "Hyperion": ["hyperion", "epm"],
    # healthcare IT
    "Epic": ["epic", "epic systems", "epic certified"], "Cerner": ["cerner", "oracle health"], "Meditech": ["meditech"], "Allscripts": ["allscripts"],
    "HL7": ["hl7", "hl7 v2"], "FHIR": ["fhir"], "EHR": ["ehr", "emr", "electronic health record"], "Clinical informatics": ["clinical informatics", "nursing informatics"],
    "Revenue cycle": ["revenue cycle", "rcm", "medical billing"], "ICD-10": ["icd-10", "icd10", "medical coding"], "Mirth": ["mirth", "mirth connect"],
    "Healthcare": ["healthcare", "health care", "hospital", "clinical", "payer", "provider"], "Pharma": ["pharma", "pharmaceutical", "life sciences", "gxp"],
    # QA / testing
    "Selenium": ["selenium"], "Cypress": ["cypress"], "Playwright": ["playwright"], "JUnit": ["junit"], "TestNG": ["testng"], "Postman": ["postman"],
    "Automation testing": ["automation testing", "test automation", "qa automation", "sdet"], "Manual testing": ["manual testing", "qa tester", "quality assurance"],
    "Performance testing": ["performance testing", "jmeter", "loadrunner"], "Cucumber": ["cucumber", "bdd"], "Appium": ["appium"], "Tosca": ["tosca"], "UFT": ["uft", "qtp"],
    # mobile
    "iOS": ["ios"], "Android": ["android"], "React Native": ["react native"], "Flutter": ["flutter"], "Xamarin": ["xamarin"],
    # process / management
    "Agile": ["agile"], "Scrum": ["scrum", "scrum master", "csm"], "SAFe": ["safe", "scaled agile"], "Kanban": ["kanban"], "Jira": ["jira"], "Confluence": ["confluence"],
    "Project management": ["project management", "project manager", "pmp"], "Program management": ["program management", "program manager"],
    "Product management": ["product management", "product owner", "product manager"], "Business analysis": ["business analyst", "business analysis", "requirements gathering", "cbap"],
    "ITIL": ["itil"], "Six Sigma": ["six sigma", "lean six sigma"], "Change management": ["change management"], "Stakeholder management": ["stakeholder management"],
    "UML": ["uml"], "Visio": ["visio"], "Excel": ["excel", "advanced excel"], "Data analysis": ["data analysis", "data analyst", "analytics"],
    # support / infra
    "Help desk": ["help desk", "helpdesk", "service desk", "desktop support", "technical support", "it support"], "Storage": ["san", "nas", "netapp", "emc"],
    "Backup": ["backup", "veeam", "commvault"], "Citrix": ["citrix", "vdi"], "Exchange": ["exchange", "exchange online"], "DNS/DHCP": ["dns", "dhcp"],
    "Mainframe": ["mainframe", "jcl", "db2", "cics"], "AS/400": ["as/400", "as400", "iseries", "rpg"],
    # architecture / misc
    "Solution architecture": ["solution architect", "solutions architect", "solution architecture", "enterprise architect", "togaf"],
    "System design": ["system design", "distributed systems"], "API design": ["api design", "openapi", "swagger"], "Message queues": ["rabbitmq", "activemq", "sqs", "jms"],
    "Embedded": ["embedded", "firmware", "rtos"], "IoT": ["iot"], "Blockchain": ["blockchain", "solidity"], "Unity": ["unity"], "SAP Integration": ["sap pi", "sap po", "cpi", "integration suite"],
    "UX design": ["ux", "ui/ux", "figma", "user experience"], "Technical writing": ["technical writing", "documentation"],
}

TITLES: list[str] = [
    "software engineer", "software developer", "senior software engineer", "full stack developer", "full stack engineer", "front end developer", "frontend developer",
    "back end developer", "backend developer", "java developer", "python developer", ".net developer", "web developer", "mobile developer", "ios developer", "android developer",
    "data engineer", "data scientist", "data analyst", "business intelligence developer", "bi developer", "etl developer", "database administrator", "dba", "data architect",
    "machine learning engineer", "ai engineer", "devops engineer", "cloud engineer", "cloud architect", "site reliability engineer", "platform engineer", "systems engineer",
    "systems administrator", "system administrator", "network engineer", "network administrator", "security engineer", "security analyst", "cybersecurity analyst",
    "information security analyst", "soc analyst", "penetration tester", "qa engineer", "qa analyst", "test engineer", "automation engineer", "sdet", "quality assurance analyst",
    "business analyst", "systems analyst", "business systems analyst", "product manager", "product owner", "project manager", "program manager", "scrum master", "agile coach",
    "delivery manager", "engagement manager", "it manager", "it director", "solutions architect", "solution architect", "enterprise architect", "technical architect",
    "application architect", "software architect", "technical lead", "tech lead", "team lead", "engineering manager", "help desk analyst", "desktop support technician",
    "it support specialist", "technical support engineer", "service desk analyst", "sap consultant", "sap fico consultant", "sap mm consultant", "sap sd consultant",
    "sap abap developer", "sap basis administrator", "sap pp consultant", "sap hcm consultant", "sap analyst", "oracle developer", "oracle dba", "oracle ebs consultant",
    "oracle fusion consultant", "workday consultant", "workday analyst", "salesforce developer", "salesforce administrator", "salesforce consultant", "servicenow developer",
    "servicenow administrator", "sharepoint developer", "dynamics 365 consultant", "crm consultant", "erp consultant", "erp analyst", "peoplesoft consultant",
    "epic analyst", "epic consultant", "clinical analyst", "clinical informatics specialist", "healthcare it analyst", "cerner analyst", "hl7 integration analyst",
    "interface analyst", "ehr analyst", "revenue cycle analyst", "informatica developer", "tableau developer", "power bi developer", "snowflake developer", "hadoop developer",
    "spark developer", "kafka engineer", "big data engineer", "embedded software engineer", "firmware engineer", "ux designer", "ui developer", "technical writer",
    "release manager", "build engineer", "integration engineer", "mulesoft developer", "api developer", "rpa developer", "uipath developer", "pega developer",
    "mainframe developer", "cobol developer", "guidewire developer", "it auditor", "compliance analyst", "identity and access management engineer", "iam engineer",
    "cloud security engineer", "aws engineer", "azure engineer", "azure administrator", "linux administrator", "windows administrator", "vmware administrator",
    "storage engineer", "backup administrator", "citrix engineer", "exchange administrator", "it project coordinator", "technical project manager", "it business analyst",
    "data entry", "recruiter", "technical recruiter", "it recruiter", "account manager", "business development manager",
]

SENIORITY = [
    ("principal", "Principal"), ("staff", "Staff"), ("architect", "Architect"), ("director", "Director"), ("vp", "Executive"), ("head of", "Executive"),
    ("chief", "Executive"), ("manager", "Manager"), ("lead", "Lead"), ("sr.", "Senior"), ("sr ", "Senior"), ("senior", "Senior"), ("mid", "Mid"),
    ("jr", "Junior"), ("junior", "Junior"), ("associate", "Junior"), ("intern", "Intern"), ("entry", "Junior"),
]
