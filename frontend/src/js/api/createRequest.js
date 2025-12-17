const createRequest = async (options = {}) => {
  const { url, method, data } = options;
  
  try {
    const response = await fetch(url, {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : null,
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      const error = new Error(responseData.message || `HTTP error! status: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return responseData;
  } catch (error) {
    console.error('Request error:', error);
    throw error;
  }
};

export default createRequest;