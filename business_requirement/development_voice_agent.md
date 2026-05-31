#  Development Architecture

## Clients
* Clients can be from any sector. So we are sector agnostic. We are developing voice assistants to fit in any use cases.
* If we want to enable these voice assistants for Customer success team at a Oracle/SAP HCM or CRM tool team, we can enable.
* Such that, we will have the client specific data. And this data can be anything.

**Example**
* We are enabling this voice agents to help customer success teams at Oracle with in Oracle HCM saas product. So we will have access to all the customer data which are there in Oracle HCM saas product. Like their HCM product, how it works, how they behave, functional flows specific. This is client data. We cannot expose this data to any other client. 
* Another example: We can enable these voice agents to Real Estate companies, so the people/agents working for that company can use these voice agents to help their customers. These customers may be - general public looking for buying/renting a house. Or may be agents working for the same company or brokers from other agencies. In this example we will have the client data as properties, locations, flat details, what is the interior / exterior design etc. This is client data. We cannot expose this data to any other client. 
* We have to enable voice agents such that they understand the user query (in natural language) and respond to them appropriately.

# Strategy
* Customers/Clients or People can directly interact with the voice assistant. They can ask queries on the product these voice assitants are enabled.
* Make a note, now as we enabled we already have the client data and how this agent shall behave.
    ## Process:
        * As customer asked a query, we shall first send this voice query to backend.
        * Then extract the text from the voice query. 
        * Then we shall invoke the LLM agent and send the prompt with client data, user queries.
        * Return the LLM response in a voice format to the Frontend.


# Main Note: We already developed some portion of this code. But I want to make the structured changes from voice to text, then to LLM agent, then to response in voice.
 
